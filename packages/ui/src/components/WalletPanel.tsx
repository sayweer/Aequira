import type { ReactNode } from 'react';

import type { WalletConnection } from '../hooks/useWalletConnection.js';
import { LACE_INSTALL_URL, shortenAddress } from '../wallet.js';
import { StageMessage } from './StageMessage.js';

const statusLabel = (viewState: WalletConnection['viewState']): string => {
  switch (viewState) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting';
    case 'detecting':
      return 'Detecting';
    default:
      return 'Not connected';
  }
};

type WalletPanelProps = {
  readonly busy: boolean;
  readonly children?: ReactNode;
  readonly wallet: WalletConnection;
};

export const WalletPanel = ({ busy, children, wallet }: WalletPanelProps) => {
  const { connectedWallet, errorMessage, isConnected, selectedWallet, viewState, wallets } = wallet;

  return (
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
          {statusLabel(viewState)}
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
            Install or enable Lace in Chrome, then refresh detection. The extension must be unlocked
            before connecting.
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
              onClick={wallet.retryDetection}
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
              {wallets.map((injected) => (
                <label className="wallet-option" key={injected.id}>
                  <input
                    checked={injected.id === wallet.selectedWalletId}
                    disabled={viewState === 'connecting'}
                    name="wallet"
                    onChange={() => wallet.selectWallet(injected.id)}
                    type="radio"
                    value={injected.id}
                  />
                  <span>
                    <strong>{injected.api.name}</strong>
                    <small>{injected.api.rdns}</small>
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
            <StageMessage
              onDismiss={wallet.retryConnection}
              text={errorMessage}
              title="Connection needs attention"
            />
          )}

          <button
            aria-busy={viewState === 'connecting'}
            className="button button-primary button-full"
            disabled={selectedWallet === null || viewState === 'connecting'}
            type="button"
            onClick={() => void wallet.connect()}
          >
            {viewState === 'connecting' ? 'Approve in Lace…' : 'Connect Lace'}
          </button>
          <p className="privacy-note">
            AEQUIRA requests only the wallet capabilities needed for this Preprod session.
          </p>
        </div>
      )}

      {isConnected && connectedWallet !== null && (
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
              <dd title={connectedWallet.address}>{shortenAddress(connectedWallet.address)}</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>Preprod</dd>
            </div>
          </dl>

          {children}

          <button
            className="button button-secondary button-full"
            disabled={busy}
            type="button"
            onClick={wallet.disconnect}
          >
            Disconnect
          </button>
          <p className="privacy-note">
            Disconnecting clears this page session. Wallet permissions remain managed in Lace.
          </p>
        </div>
      )}
    </section>
  );
};
