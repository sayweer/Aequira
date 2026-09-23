import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';

export const AEQUIRA_NETWORK_ID = 'preprod';
export const LACE_INSTALL_URL =
  'https://chromewebstore.google.com/detail/lace/gafhhkghbfjjkeiendhlofajokpaflmk';

const PREPROD_UNSHIELDED_ADDRESS_PREFIX = 'mn_addr_preprod1';

/**
 * How long a connection may wait on Lace. Long enough to unlock it and approve,
 * but finite: Lace settles nothing while its approval window is hidden or never
 * opens, and without a limit the page waited on it for good with the button
 * locked, so the only way out was a reload.
 */
export const WALLET_CONNECT_TIMEOUT_MS = 60_000;

export class WalletTimeoutError extends Error {
  constructor() {
    super('Lace did not answer the connection request');
    this.name = 'WalletTimeoutError';
  }
}

export type InjectedWallet = {
  readonly api: InitialAPI;
  readonly id: string;
};

export type ConnectedWallet = {
  readonly address: string;
  readonly api: ConnectedAPI;
  readonly name: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isInitialApi = (value: unknown): value is InitialAPI =>
  isRecord(value) &&
  typeof value.apiVersion === 'string' &&
  typeof value.connect === 'function' &&
  typeof value.icon === 'string' &&
  typeof value.name === 'string' &&
  typeof value.rdns === 'string';

const readInjectedWallets = (): unknown =>
  typeof window === 'undefined'
    ? undefined
    : (window as unknown as { readonly midnight?: unknown }).midnight;

export const listInjectedWallets = (
  injected: unknown = readInjectedWallets(),
): InjectedWallet[] => {
  if (!isRecord(injected)) {
    return [];
  }

  return Object.entries(injected)
    .filter((entry): entry is [string, InitialAPI] => isInitialApi(entry[1]))
    .map(([id, api]) => ({ api, id }))
    .sort((left, right) => {
      const byName = left.api.name.localeCompare(right.api.name);
      return byName === 0 ? left.api.rdns.localeCompare(right.api.rdns) : byName;
    });
};

export const shortenAddress = (address: string): string =>
  address.length <= 30 ? address : `${address.slice(0, 18)}…${address.slice(-10)}`;

export const isPreprodUnshieldedAddress = (address: string): boolean =>
  address.startsWith(PREPROD_UNSHIELDED_ADDRESS_PREFIX);

const withTimeout = <Value>(promise: Promise<Value>, timeoutMs: number): Promise<Value> =>
  new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new WalletTimeoutError()), timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });

export const connectInjectedWallet = (
  wallet: InitialAPI,
  timeoutMs = WALLET_CONNECT_TIMEOUT_MS,
): Promise<ConnectedWallet> => withTimeout(openConnection(wallet), timeoutMs);

const openConnection = async (wallet: InitialAPI): Promise<ConnectedWallet> => {
  const connectedApi = await wallet.connect(AEQUIRA_NETWORK_ID);
  const [{ unshieldedAddress }, connectionStatus] = await Promise.all([
    connectedApi.getUnshieldedAddress(),
    connectedApi.getConnectionStatus(),
  ]);

  if (connectionStatus.status !== 'connected') {
    throw new Error('Wallet did not confirm the connection');
  }
  if (!isPreprodUnshieldedAddress(unshieldedAddress)) {
    throw new Error('Wallet returned an address outside Midnight Preprod');
  }

  return {
    address: unshieldedAddress,
    api: connectedApi,
    name: wallet.name,
  };
};

export const toWalletErrorMessage = (error: unknown): string => {
  if (error instanceof WalletTimeoutError) {
    return 'Lace did not answer. Its approval window may be hidden behind this one, or Lace may be locked. Open Lace from the browser toolbar, unlock it, then connect again.';
  }

  const message = error instanceof Error ? error.message.toLowerCase() : '';

  if (message.includes('reject') || message.includes('declin') || message.includes('cancel')) {
    return 'Connection was cancelled in Lace. You can try again when ready.';
  }
  if (message.includes('outside midnight preprod')) {
    return 'Lace returned a non-Preprod address. Select Midnight Preprod in Lace and reconnect.';
  }
  if (message.includes('did not confirm')) {
    return 'Lace did not confirm the session. Unlock the wallet and try again.';
  }

  return 'Lace could not connect. Confirm that it is unlocked, synced, and set to Midnight Preprod.';
};
