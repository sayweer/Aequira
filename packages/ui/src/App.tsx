import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  AEQUIRA_NETWORK_ID,
  LACE_INSTALL_URL,
  connectInjectedWallet,
  listInjectedWallets,
  shortenAddress,
  toWalletErrorMessage,
  type ConnectedWallet,
  type InjectedWallet,
} from './wallet.js';

type WalletViewState = 'connected' | 'connecting' | 'detecting' | 'error' | 'no-wallet' | 'ready';

const DETECTION_INTERVAL_MS = 250;
const DETECTION_TIMEOUT_MS = 5_000;
const CONNECTION_STATUS_INTERVAL_MS = 5_000;

const App = () => {
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

  const isConnected = viewState === 'connected' && connectedWallet !== null;

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand-lockup" href="/" aria-label="AEQUIRA home">
          <span className="brand-mark" aria-hidden="true">
            A
          </span>
          <span>AEQUIRA</span>
        </a>
        <div className="network-chip" aria-label="Network: Midnight Preprod">
          <span className="network-dot" aria-hidden="true" />
          Midnight {AEQUIRA_NETWORK_ID}
        </div>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">Private review · Public proof</p>
            <h1 id="hero-title">A score can be verified before it is seen.</h1>
            <p className="hero-intro">
              Reviewers commit decisions without publishing the score. AEQUIRA keeps the evidence
              verifiable and the sensitive input local until reveal.
            </p>

            <ol className="flow-rail" aria-label="Demo progress">
              <li className={isConnected ? 'flow-step is-complete' : 'flow-step is-current'}>
                <span className="step-index">01</span>
                <span>
                  <strong>Connect Lace</strong>
                  <small>
                    {isConnected ? 'Preprod session ready' : 'Authorize this browser session'}
                  </small>
                </span>
              </li>
              <li className="flow-step">
                <span className="step-index">02</span>
                <span>
                  <strong>Resolve contract</strong>
                  <small>Next implementation slice</small>
                </span>
              </li>
              <li className="flow-step">
                <span className="step-index">03</span>
                <span>
                  <strong>Commit private score</strong>
                  <small>Only the salted commitment becomes public</small>
                </span>
              </li>
            </ol>
          </div>

          <section className="wallet-panel" aria-labelledby="wallet-heading">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">Wallet session</p>
                <h2 id="wallet-heading">Lace on Preprod</h2>
              </div>
              <span
                className={`status-badge status-${viewState}`}
                aria-live="polite"
                aria-label={`Wallet status: ${viewState}`}
              >
                {viewState === 'connected'
                  ? 'Connected'
                  : viewState === 'connecting'
                    ? 'Connecting'
                    : viewState === 'detecting'
                      ? 'Detecting'
                      : 'Not connected'}
              </span>
            </div>

            {viewState === 'detecting' && (
              <div className="wallet-skeleton" aria-busy="true" aria-label="Detecting Lace">
                <span />
                <span />
                <span />
                <p>Looking for a Midnight wallet in this browser…</p>
              </div>
            )}

            {viewState === 'no-wallet' && (
              <div className="panel-state">
                <p className="state-title">Lace was not detected</p>
                <p>
                  Install or enable Lace in Chrome, then refresh detection. The extension must be
                  unlocked before connecting.
                </p>
                <div className="button-row">
                  <a
                    className="button button-primary"
                    href={LACE_INSTALL_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Install Lace
                  </a>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={retryDetection}
                  >
                    Detect again
                  </button>
                </div>
              </div>
            )}

            {(viewState === 'ready' || viewState === 'connecting' || viewState === 'error') && (
              <div className="panel-state">
                {wallets.length > 1 ? (
                  <fieldset className="wallet-options">
                    <legend>Choose a wallet</legend>
                    {wallets.map((wallet) => (
                      <label className="wallet-option" key={wallet.id}>
                        <input
                          checked={wallet.id === selectedWalletId}
                          disabled={viewState === 'connecting'}
                          name="wallet"
                          onChange={() => setSelectedWalletId(wallet.id)}
                          type="radio"
                          value={wallet.id}
                        />
                        <span>
                          <strong>{wallet.api.name}</strong>
                          <small>{wallet.api.rdns}</small>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                ) : (
                  <div className="detected-wallet">
                    <span className="wallet-monogram" aria-hidden="true">
                      L
                    </span>
                    <span>
                      <strong>{selectedWallet?.api.name ?? 'Midnight wallet'}</strong>
                      <small>Detected in this browser</small>
                    </span>
                  </div>
                )}

                {errorMessage !== null && (
                  <div className="error-message" role="alert">
                    <strong>Connection needs attention</strong>
                    <p>{errorMessage}</p>
                    <button className="text-button" type="button" onClick={retryConnection}>
                      Dismiss and retry
                    </button>
                  </div>
                )}

                <button
                  aria-busy={viewState === 'connecting'}
                  className="button button-primary button-full"
                  disabled={selectedWallet === null || viewState === 'connecting'}
                  type="button"
                  onClick={() => void connect()}
                >
                  {viewState === 'connecting' ? 'Approve in Lace…' : 'Connect Lace'}
                </button>
                <p className="privacy-note">
                  AEQUIRA requests only the wallet capabilities needed for this Preprod session.
                </p>
              </div>
            )}

            {isConnected && (
              <div className="connected-state">
                <div className="connected-wallet-row">
                  <span className="wallet-monogram is-connected" aria-hidden="true">
                    ✓
                  </span>
                  <span>
                    <strong>{connectedWallet.name}</strong>
                    <small>Authorized for Midnight Preprod</small>
                  </span>
                </div>

                <dl className="address-block">
                  <div>
                    <dt>Public unshielded address</dt>
                    <dd title={connectedWallet.address}>
                      {shortenAddress(connectedWallet.address)}
                    </dd>
                  </div>
                  <div>
                    <dt>Network</dt>
                    <dd>Preprod</dd>
                  </div>
                </dl>

                <button
                  className="button button-secondary button-full"
                  type="button"
                  onClick={disconnect}
                >
                  Disconnect
                </button>
                <p className="privacy-note">
                  Disconnecting clears this page session. Wallet permissions remain managed in Lace.
                </p>
              </div>
            )}
          </section>
        </section>

        <section className="privacy-boundary" aria-labelledby="boundary-heading">
          <div className="boundary-intro">
            <p className="eyebrow">Privacy boundary</p>
            <h2 id="boundary-heading">The proof travels. The score does not.</h2>
          </div>
          <div className="boundary-list">
            <div>
              <span className="boundary-label">Public</span>
              <p>Contract address, transaction result, score commitment, replay nullifier.</p>
            </div>
            <div>
              <span className="boundary-label">Local</span>
              <p>Reviewer secret, score value, score salt, and unrevealed private state.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <p>AEQUIRA · Anonymous Eligibility, Qualified Impartial Rubric Attestation</p>
        <p>Preprod prototype</p>
      </footer>
    </div>
  );
};

export default App;
