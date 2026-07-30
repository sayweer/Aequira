import type {
  AequiraCircuitKey,
  AequiraPrivateState,
  AequiraPrivateStateId,
  AequiraProviders,
} from '@aequira/sdk';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { fromHex, toHex } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import {
  Binding,
  type FinalizedTransaction,
  Proof,
  SignatureEnabled,
  Transaction,
  type TransactionId,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';
import { validatePassword } from '@midnight-ntwrk/midnight-js-utils';

import { normalizeLocalProofServerUrl } from './provider-security.js';
import { AEQUIRA_NETWORK_ID } from './wallet.js';

const DEFAULT_PROOF_SERVER_URL = 'http://127.0.0.1:6300';
const PRIVATE_STATE_DATABASE = 'aequira-browser-state';
const PRIVATE_STATE_STORE = 'aequira-private-state';
const SIGNING_KEY_STORE = 'aequira-signing-keys';

type EncryptedBrowserPrivateStateProvider = AequiraProviders['privateStateProvider'] & {
  invalidateEncryptionCache(): Promise<void>;
};

export class DustUnavailableError extends Error {
  constructor() {
    super('DUST is not ready');
    this.name = 'DustUnavailableError';
  }
}

export type BrowserProviderSession = {
  readonly providers: AequiraProviders;
  close(): Promise<void>;
};

const resolveProofServerUrl = (walletProofServerUrl: string | undefined): string => {
  const configuredUrl = import.meta.env.VITE_PROOF_SERVER_URL?.trim();

  // ZK preimages may contain private witness material, so proving stays on this machine.
  return normalizeLocalProofServerUrl(
    configuredUrl || walletProofServerUrl?.trim() || DEFAULT_PROOF_SERVER_URL,
  );
};

export const createBrowserProviderSession = async (
  connectedApi: ConnectedAPI,
  privateStatePassword: string,
): Promise<BrowserProviderSession> => {
  validatePassword(privateStatePassword);
  setNetworkId(AEQUIRA_NETWORK_ID);

  await connectedApi.hintUsage([
    'getConfiguration',
    'getDustBalance',
    'getShieldedAddresses',
    'balanceUnsealedTransaction',
    'submitTransaction',
  ]);

  const [configuration, dust, shieldedAddresses] = await Promise.all([
    connectedApi.getConfiguration(),
    connectedApi.getDustBalance(),
    connectedApi.getShieldedAddresses(),
  ]);

  if (configuration.networkId !== AEQUIRA_NETWORK_ID) {
    throw new Error('Wallet provider configuration is outside Midnight Preprod');
  }
  if (dust.balance <= 0n) {
    throw new DustUnavailableError();
  }

  const passwordHolder = { value: privateStatePassword };
  const privateStateProvider = levelPrivateStateProvider<
    AequiraPrivateStateId,
    AequiraPrivateState
  >({
    accountId: shieldedAddresses.shieldedAddress,
    midnightDbName: PRIVATE_STATE_DATABASE,
    privateStateStoreName: PRIVATE_STATE_STORE,
    signingKeyStoreName: SIGNING_KEY_STORE,
    privateStoragePasswordProvider: () => passwordHolder.value,
  }) as EncryptedBrowserPrivateStateProvider;
  try {
    const zkConfigProvider = new FetchZkConfigProvider<AequiraCircuitKey>(
      window.location.origin,
      fetch.bind(window),
    );
    const providers: AequiraProviders = {
      privateStateProvider,
      proofProvider: httpClientProofProvider(
        resolveProofServerUrl(configuration.proverServerUri),
        zkConfigProvider,
      ),
      publicDataProvider: indexerPublicDataProvider(
        configuration.indexerUri,
        configuration.indexerWsUri,
        globalThis.WebSocket as unknown as NonNullable<
          Parameters<typeof indexerPublicDataProvider>[2]
        >,
      ),
      zkConfigProvider,
      walletProvider: {
        getCoinPublicKey: () => shieldedAddresses.shieldedCoinPublicKey,
        getEncryptionPublicKey: () => shieldedAddresses.shieldedEncryptionPublicKey,
        balanceTx: async (transaction: UnboundTransaction): Promise<FinalizedTransaction> => {
          const balanced = await connectedApi.balanceUnsealedTransaction(
            toHex(transaction.serialize()),
          );

          return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
            'signature',
            'proof',
            'binding',
            fromHex(balanced.tx),
          );
        },
      },
      midnightProvider: {
        submitTx: async (transaction: FinalizedTransaction): Promise<TransactionId> => {
          await connectedApi.submitTransaction(toHex(transaction.serialize()));
          const transactionId = transaction.identifiers()[0];

          if (transactionId === undefined) {
            throw new Error('Submitted transaction did not expose an identifier');
          }

          return transactionId;
        },
      },
    };
    let closed = false;

    return {
      providers,
      async close(): Promise<void> {
        if (closed) {
          return;
        }

        closed = true;
        passwordHolder.value = '';
        await privateStateProvider.invalidateEncryptionCache();
      },
    };
  } catch (error) {
    passwordHolder.value = '';
    await privateStateProvider.invalidateEncryptionCache().catch(() => undefined);
    throw error;
  }
};
