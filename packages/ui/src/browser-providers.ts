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
import {
  createProofProvider,
  type ProofProvider,
  type UnboundTransaction,
} from '@midnight-ntwrk/midnight-js-types';
import { validatePassword } from '@midnight-ntwrk/midnight-js-utils';

import { withDeploymentStage } from './deployment-errors.js';
import { type ProofMode, selectProofMode } from './proof-mode.js';
import { AEQUIRA_NETWORK_ID } from './wallet.js';

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
  readonly proofMode: ProofMode;
  readonly providers: AequiraProviders;
  close(): Promise<void>;
};

/** The DApp connector proving API, which older wallet builds may not expose. */
type ProvingCapableApi = ConnectedAPI & {
  getProvingProvider: NonNullable<ConnectedAPI['getProvingProvider']>;
};

const supportsWalletProving = (api: ConnectedAPI): api is ProvingCapableApi =>
  typeof api.getProvingProvider === 'function';

const createModeProofProvider = async (
  mode: ProofMode,
  api: ConnectedAPI,
  zkConfigProvider: FetchZkConfigProvider<AequiraCircuitKey>,
): Promise<ProofProvider> => {
  if (mode.kind === 'wallet') {
    const provingProvider = await (api as ProvingCapableApi).getProvingProvider(
      zkConfigProvider.asKeyMaterialProvider(),
    );

    // createProofProvider defaults to CostModel.initialCostModel(), which is the
    // cost model the generated contract already uses.
    return createProofProvider(provingProvider as Parameters<typeof createProofProvider>[0]);
  }

  return httpClientProofProvider(mode.url, zkConfigProvider);
};

export const createBrowserProviderSession = async (
  connectedApi: ConnectedAPI,
  privateStatePassword: string,
): Promise<BrowserProviderSession> => {
  validatePassword(privateStatePassword);
  setNetworkId(AEQUIRA_NETWORK_ID);

  const [configuration, dust, shieldedAddresses] = await withDeploymentStage('wallet-context', () =>
    Promise.all([
      connectedApi.getConfiguration(),
      connectedApi.getDustBalance(),
      connectedApi.getShieldedAddresses(),
    ]),
  );

  if (configuration.networkId !== AEQUIRA_NETWORK_ID) {
    throw new Error('Wallet provider configuration is outside Midnight Preprod');
  }
  if (dust.balance <= 0n) {
    throw new DustUnavailableError();
  }

  const passwordHolder = { value: privateStatePassword };
  const privateStateProvider = await withDeploymentStage(
    'private-state',
    () =>
      levelPrivateStateProvider<AequiraPrivateStateId, AequiraPrivateState>({
        accountId: shieldedAddresses.shieldedAddress,
        midnightDbName: PRIVATE_STATE_DATABASE,
        privateStateStoreName: PRIVATE_STATE_STORE,
        signingKeyStoreName: SIGNING_KEY_STORE,
        privateStoragePasswordProvider: () => passwordHolder.value,
      }) as EncryptedBrowserPrivateStateProvider,
  );
  const proofMode = selectProofMode({
    configuredUrl: import.meta.env.VITE_PROOF_SERVER_URL,
    hasProvingProvider: supportsWalletProving(connectedApi),
    isDev: import.meta.env.DEV,
    origin: window.location.origin,
    walletProverUri: configuration.proverServerUri,
  });

  try {
    const providers = await withDeploymentStage('provider-configuration', async () => {
      const initializedZkConfigProvider = new FetchZkConfigProvider<AequiraCircuitKey>(
        window.location.origin,
        fetch.bind(window),
      );
      const initializedProofProvider = await createModeProofProvider(
        proofMode,
        connectedApi,
        initializedZkConfigProvider,
      );
      const initializedProviders: AequiraProviders = {
        privateStateProvider,
        proofProvider: {
          proveTx: (transaction, config) =>
            withDeploymentStage('proof-generation', () =>
              initializedProofProvider.proveTx(transaction, config),
            ),
        },
        publicDataProvider: indexerPublicDataProvider(
          configuration.indexerUri,
          configuration.indexerWsUri,
          globalThis.WebSocket as unknown as NonNullable<
            Parameters<typeof indexerPublicDataProvider>[2]
          >,
        ),
        zkConfigProvider: initializedZkConfigProvider,
        walletProvider: {
          getCoinPublicKey: () => shieldedAddresses.shieldedCoinPublicKey,
          getEncryptionPublicKey: () => shieldedAddresses.shieldedEncryptionPublicKey,
          balanceTx: (transaction: UnboundTransaction): Promise<FinalizedTransaction> =>
            withDeploymentStage('wallet-balancing', async () => {
              const balanced = await connectedApi.balanceUnsealedTransaction(
                toHex(transaction.serialize()),
              );

              return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
                'signature',
                'proof',
                'binding',
                fromHex(balanced.tx),
              );
            }),
        },
        midnightProvider: {
          submitTx: (transaction: FinalizedTransaction): Promise<TransactionId> =>
            withDeploymentStage('transaction-submission', async () => {
              await connectedApi.submitTransaction(toHex(transaction.serialize()));
              const transactionId = transaction.identifiers()[0];

              if (transactionId === undefined) {
                throw new Error('Submitted transaction did not expose an identifier');
              }

              return transactionId;
            }),
        },
      };

      return initializedProviders;
    });
    let closed = false;

    return {
      proofMode,
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
