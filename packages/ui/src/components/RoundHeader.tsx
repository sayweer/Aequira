import type { AequiraRound } from '../hooks/useAequiraRound.js';
import type { WalletConnection } from '../hooks/useWalletConnection.js';
import { describeProofMode } from '../proof-mode.js';
import { shortenAddress } from '../wallet.js';
import { HexValue } from './HexValue.js';
import { PhaseStepper } from './PhaseStepper.js';

type RoundHeaderProps = {
  readonly round: AequiraRound;
  readonly wallet: WalletConnection;
};

export const RoundHeader = ({ round, wallet }: RoundHeaderProps) => {
  const { address, proofMode, view } = round;

  if (address === null) {
    return null;
  }

  return (
    <section className="round-header" aria-labelledby="round-heading">
      <div className="round-header-top">
        <div>
          <h1 className="round-title" id="round-heading">
            {view === null ? 'Round open' : view.phaseLabel}
          </h1>
          <p className="round-subtitle" aria-live="polite">
            {round.indexerLagging
              ? 'The indexer is not answering. The page keeps retrying.'
              : view === null
                ? 'Waiting for the indexer to show this contract…'
                : 'Live from the public ledger, refreshed every few seconds.'}
          </p>
        </div>

        <div className="wallet-summary">
          <span className="wallet-summary-name">
            {wallet.connectedWallet?.name ?? 'Wallet'}
            <span className="wallet-summary-address">
              {wallet.connectedWallet === null
                ? ''
                : shortenAddress(wallet.connectedWallet.address)}
            </span>
          </span>
          <button
            className="button button-ghost"
            disabled={round.busy !== null}
            onClick={wallet.disconnect}
            type="button"
          >
            Disconnect
          </button>
        </div>
      </div>

      <PhaseStepper phase={view?.phase ?? null} />

      <dl className="round-meta">
        <div>
          <dt>Contract</dt>
          <dd>
            <HexValue label="contract address" value={address} />
          </dd>
        </div>
        {view !== null && (
          <div>
            <dt>Round ID</dt>
            <dd>
              <HexValue label="round ID" value={view.roundIdHex} />
            </dd>
          </div>
        )}
        {proofMode !== null && (
          <div>
            <dt>Proofs</dt>
            <dd>{describeProofMode(proofMode)}</dd>
          </div>
        )}
      </dl>
    </section>
  );
};
