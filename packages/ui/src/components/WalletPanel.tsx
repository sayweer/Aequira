import type { WalletConnection } from '../hooks/useWalletConnection.js';
import { LACE_INSTALL_URL, shortenAddress } from '../wallet.js';
import { StageMessage } from './StageMessage.js';

const STATUS: Record<
  WalletConnection['viewState'],
  { readonly label: string; readonly tone: string }
> = {
  connected: { label: 'Connected', tone: 'success' },
  connecting: { label: 'Waiting for Lace', tone: 'pending' },
  detecting: { label: 'Looking for Lace', tone: 'pending' },
  error: { label: 'Not connected', tone: 'danger' },
  'no-wallet': { label: 'Lace not found', tone: 'danger' },
  ready: { label: 'Not connected', tone: 'neutral' },
};

type WalletPanelProps = {
  readonly busy: boolean;
  /** Rendered inside the wizard, which supplies the heading and the frame. */
  readonly chromeless?: boolean;
  readonly wallet: WalletConnection;
};

export const WalletPanel = ({ busy, chromeless = false, wallet }: WalletPanelProps) => {
  const { connectedWallet, errorMessage, isConnected, selectedWallet, viewState, wallets } = wallet;
  const status = STATUS[viewState];

  const body = (
    <>
      {viewState === 'detecting' && (
        <div className="skeleton" aria-busy="true" aria-label="Looking for Lace">
          <span />
          <span />
        </div>
      )}

      {viewState === 'no-wallet' && (
        <>
          <p className="panel-text">
            Install or enable Lace in Chrome and unlock it, then look again.
          </p>
          <div className="button-row">
            <a
              className="button button-primary"
              href={LACE_INSTALL_URL}
              rel="noreferrer"
              target="_blank"
            >
              Install Lace
            </a>
            <button
              className="button button-secondary"
              onClick={wallet.retryDetection}
              type="button"
            >
              Look again
            </button>
          </div>
        </>
      )}

      {(viewState === 'ready' || viewState === 'connecting' || viewState === 'error') && (
        <>
          {wallets.length > 1 ? (
            <fieldset className="wallet-options">
              <legend className="field-label">Choose a wallet</legend>
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
            <p className="panel-text">
              {selectedWallet?.api.name ?? 'A Midnight wallet'} is installed in this browser.
              AEQUIRA asks only for what a Preprod session needs.
            </p>
          )}

          {errorMessage !== null && (
            <StageMessage
              onDismiss={wallet.retryConnection}
              text={errorMessage}
              title="Lace did not connect"
            />
          )}

          <button
            aria-busy={viewState === 'connecting'}
            className="button button-primary button-full"
            disabled={selectedWallet === null || viewState === 'connecting'}
            onClick={() => void wallet.connect()}
            type="button"
          >
            {viewState === 'connecting' && <span className="spinner" aria-hidden="true" />}
            <span>{viewState === 'connecting' ? 'Approve in Lace…' : 'Connect Lace'}</span>
          </button>
          {viewState === 'connecting' && (
            <p className="field-hint">
              No Lace window? It may be behind this one, or Lace may be locked: open it from the
              browser toolbar.
            </p>
          )}
        </>
      )}

      {isConnected && connectedWallet !== null && (
        <>
          <dl className="key-values">
            <div>
              <dt>Wallet</dt>
              <dd>{connectedWallet.name}</dd>
            </div>
            <div>
              <dt>Address</dt>
              <dd className="mono" title={connectedWallet.address}>
                {shortenAddress(connectedWallet.address)}
              </dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>Preprod</dd>
            </div>
          </dl>
          <button
            className="button button-ghost"
            disabled={busy}
            onClick={wallet.disconnect}
            type="button"
          >
            Disconnect
          </button>
        </>
      )}
    </>
  );

  if (chromeless) {
    return (
      <>
        <div className="chip-row">
          <span className="chip" data-tone={status.tone} aria-live="polite">
            {status.label}
          </span>
        </div>
        {body}
      </>
    );
  }

  return (
    <section className="panel" aria-labelledby="wallet-heading">
      <header className="panel-header">
        <div>
          <p className="panel-label">Step 1</p>
          <h2 className="panel-title" id="wallet-heading">
            Connect your wallet
          </h2>
        </div>
        <span className="chip" data-tone={status.tone} aria-live="polite">
          {status.label}
        </span>
      </header>
      {body}
    </section>
  );
};
