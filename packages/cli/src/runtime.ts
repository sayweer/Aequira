import path from 'node:path';
import { chmod, mkdir } from 'node:fs/promises';

import type { AequiraCircuitKey, AequiraProviders } from '@aequira/sdk';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
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

    return new EncryptedPrivateStateStore(provider, passwordHolder);
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
