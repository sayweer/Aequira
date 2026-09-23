import path from 'node:path';
import { chmod, mkdir } from 'node:fs/promises';

import type { AequiraCircuitKey, AequiraProviders } from '@aequira/sdk';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { SigningKeyExportError } from '@midnight-ntwrk/midnight-js-types';
import { validatePassword } from '@midnight-ntwrk/midnight-js-utils';

import type { CliConfig } from './config.js';
import { AequiraWalletProvider } from './wallet-provider.js';

const DATABASE_NAME = 'midnight-state';
const PRIVATE_STATE_STORE_NAME = 'aequira-private-state';
const SIGNING_KEY_STORE_NAME = 'aequira-signing-keys';

type EncryptedPrivateStateProvider = AequiraProviders['privateStateProvider'] & {
  invalidateEncryptionCache(): Promise<void>;
};

type AequiraPrivateStateId = Parameters<AequiraProviders['privateStateProvider']['get']>[0];
type AequiraPrivateState = Exclude<
  Awaited<ReturnType<AequiraProviders['privateStateProvider']['get']>>,
  null
>;

export class EncryptedPrivateStateStore {
  readonly provider: EncryptedPrivateStateProvider;

  readonly #passwordHolder: { value: string };

  private constructor(provider: EncryptedPrivateStateProvider, passwordHolder: { value: string }) {
    this.provider = provider;
    this.#passwordHolder = passwordHolder;
  }

  static async create(
    config: CliConfig,
    accountId: string,
    password: string,
  ): Promise<EncryptedPrivateStateStore> {
    validatePassword(password);

    await mkdir(config.privateStateDirectory, {
      recursive: true,
      mode: 0o700,
    });
    await chmod(config.privateStateDirectory, 0o700);

    const passwordHolder = { value: password };
    const provider = levelPrivateStateProvider<AequiraPrivateStateId, AequiraPrivateState>({
      accountId,
      midnightDbName: path.join(config.privateStateDirectory, DATABASE_NAME),
      privateStateStoreName: PRIVATE_STATE_STORE_NAME,
      signingKeyStoreName: SIGNING_KEY_STORE_NAME,
      privateStoragePasswordProvider: () => passwordHolder.value,
    });

    const store = new EncryptedPrivateStateStore(provider, passwordHolder);

    try {
      await store.#assertPasswordOpensStore();
    } catch (error) {
      await store.dispose();
      throw error;
    }

    return store;
  }

  /**
   * Refuses a password the existing store was not written with.
   *
   * The provider keeps no password verifier: a wrong password derives a
   * different key from the stored salt and every write still succeeds, leaving
   * entries that the real password cannot read and that break every later
   * export, so every backup. Exporting the signing keys decrypts each one, and
   * every round this store holds has one. A `SigningKeyExportError` is raised
   * only after that, for an empty store or a key count limit, so it proves the
   * password; anything else means it did not open the store.
   */
  async #assertPasswordOpensStore(): Promise<void> {
    try {
      await this.provider.exportSigningKeys();
    } catch (error) {
      if (error instanceof SigningKeyExportError) {
        return;
      }

      throw new Error(
        'The private-state storage password does not open the existing store; nothing was written',
      );
    }
  }

  async dispose(): Promise<void> {
    this.#passwordHolder.value = '';
    await this.provider.invalidateEncryptionCache();
  }
}

const closeRuntimeResources = async (
  wallet: AequiraWalletProvider,
  privateStateStore: EncryptedPrivateStateStore | undefined,
): Promise<void> => {
  const results = await Promise.allSettled([
    wallet.stop(),
    privateStateStore?.dispose() ?? Promise.resolve(),
  ]);
  const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));

  if (errors.length > 0) {
    throw new AggregateError(errors, 'AEQUIRA runtime could not close cleanly');
  }
};

export type AequiraRuntime = {
  readonly providers: AequiraProviders;
  readonly wallet: AequiraWalletProvider;
  close(): Promise<void>;
};

export type CreateAequiraRuntimeOptions = {
  readonly config: CliConfig;
  readonly privateStatePassword: string;
  readonly walletSeed: Uint8Array;
};

export const createAequiraRuntime = async (
  options: CreateAequiraRuntimeOptions,
): Promise<AequiraRuntime> => {
  const { config, privateStatePassword, walletSeed } = options;
  setNetworkId(config.network);

  const wallet = await AequiraWalletProvider.create(config, walletSeed);
  let privateStateStore: EncryptedPrivateStateStore | undefined;

  try {
    privateStateStore = await EncryptedPrivateStateStore.create(
      config,
      wallet.accountId,
      privateStatePassword,
    );
    const zkConfigProvider = new NodeZkConfigProvider<AequiraCircuitKey>(config.zkConfigPath);
    const providers: AequiraProviders = {
      privateStateProvider: privateStateStore.provider,
      publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWs),
      zkConfigProvider,
      proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
      walletProvider: wallet,
      midnightProvider: wallet,
    };
    let closed = false;

    return {
      providers,
      wallet,
      async close(): Promise<void> {
        if (closed) {
          return;
        }

        closed = true;
        await closeRuntimeResources(wallet, privateStateStore);
      },
    };
  } catch (error) {
    await Promise.allSettled([wallet.stop(), privateStateStore?.dispose() ?? Promise.resolve()]);
    throw error;
  }
};
