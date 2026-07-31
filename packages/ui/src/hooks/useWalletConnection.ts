import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  connectInjectedWallet,
  listInjectedWallets,
  toWalletErrorMessage,
  type ConnectedWallet,
  type InjectedWallet,
} from '../wallet.js';

export type WalletViewState =
  | 'connected'
  | 'connecting'
  | 'detecting'
  | 'error'
  | 'no-wallet'
  | 'ready';

const DETECTION_INTERVAL_MS = 250;
const DETECTION_TIMEOUT_MS = 5_000;
const CONNECTION_STATUS_INTERVAL_MS = 5_000;

export type WalletConnection = {
  readonly connectedWallet: ConnectedWallet | null;
  readonly errorMessage: string | null;
  readonly isConnected: boolean;
  readonly selectedWallet: InjectedWallet | null;
  readonly selectedWalletId: string | null;
  readonly viewState: WalletViewState;
  readonly wallets: readonly InjectedWallet[];
  connect(): Promise<void>;
  disconnect(): void;
  retryConnection(): void;
  retryDetection(): void;
  selectWallet(walletId: string): void;
};

/**
 * Owns wallet discovery and the Lace session.
 *
 * Dropping the connection only clears the wallet state. Anything built on the
 * session watches `connectedWallet` and tears itself down, which keeps this hook
 * independent of its consumers.
 */
export const useWalletConnection = (): WalletConnection => {
  const [viewState, setViewState] = useState<WalletViewState>('detecting');
  const [wallets, setWallets] = useState<InjectedWallet[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [connectedWallet, setConnectedWallet] = useState<ConnectedWallet | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [detectionAttempt, setDetectionAttempt] = useState(0);

  useEffect(() => {
    let elapsed = 0;
    let intervalId: number | undefined;

    const detect = () => {
      const detected = listInjectedWallets();

      if (detected.length > 0) {
        setWallets(detected);
        setSelectedWalletId((current) =>
          current !== null && detected.some((wallet) => wallet.id === current)
            ? current
            : (detected[0]?.id ?? null),
        );
        setViewState('ready');

        if (intervalId !== undefined) {
          window.clearInterval(intervalId);
        }
        return;
      }

      if (elapsed >= DETECTION_TIMEOUT_MS) {
        setWallets([]);
        setSelectedWalletId(null);
        setViewState('no-wallet');

        if (intervalId !== undefined) {
          window.clearInterval(intervalId);
        }
      }
    };

    detect();
    intervalId = window.setInterval(() => {
      elapsed += DETECTION_INTERVAL_MS;
      detect();
    }, DETECTION_INTERVAL_MS);

    return () => {
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [detectionAttempt]);

  useEffect(() => {
    if (connectedWallet === null) {
      return;
    }

    let active = true;
    const intervalId = window.setInterval(() => {
      void connectedWallet.api
        .getConnectionStatus()
        .then((status) => {
          if (active && status.status !== 'connected') {
            setConnectedWallet(null);
            setErrorMessage(null);
            setViewState('ready');
          }
        })
        .catch(() => {
          // A temporary status read failure does not revoke an otherwise usable session.
        });
    }, CONNECTION_STATUS_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [connectedWallet]);

  const selectedWallet = useMemo(
    () => wallets.find((wallet) => wallet.id === selectedWalletId) ?? null,
    [selectedWalletId, wallets],
  );

  const connect = useCallback(async () => {
    if (selectedWallet === null || viewState === 'connecting') {
      return;
    }

    setErrorMessage(null);
    setViewState('connecting');

    try {
      const connection = await connectInjectedWallet(selectedWallet.api);
      setConnectedWallet(connection);
      setViewState('connected');
    } catch (error) {
      setConnectedWallet(null);
      setErrorMessage(toWalletErrorMessage(error));
      setViewState('error');
    }
  }, [selectedWallet, viewState]);

  const disconnect = useCallback(() => {
    setConnectedWallet(null);
    setErrorMessage(null);
    setViewState('ready');
  }, []);

  const retryDetection = useCallback(() => {
    setErrorMessage(null);
    setViewState('detecting');
    setDetectionAttempt((attempt) => attempt + 1);
  }, []);

  const retryConnection = useCallback(() => {
    setErrorMessage(null);
    setViewState('ready');
  }, []);

  const selectWallet = useCallback((walletId: string) => {
    setSelectedWalletId(walletId);
  }, []);

  return {
    connect,
    connectedWallet,
    disconnect,
    errorMessage,
    isConnected: viewState === 'connected' && connectedWallet !== null,
    retryConnection,
    retryDetection,
    selectWallet,
    selectedWallet,
    selectedWalletId,
    viewState,
    wallets,
  };
};
