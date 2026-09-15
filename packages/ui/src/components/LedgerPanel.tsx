import type { AequiraRound } from '../hooks/useAequiraRound.js';
import { shortenHex } from '../round-format.js';

type LedgerPanelProps = {
  readonly round: AequiraRound;
};

export const LedgerPanel = ({ round }: LedgerPanelProps) => {
  const { view } = round;

  return (
    <section className="round-card" aria-labelledby="ledger-heading">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Public ledger</p>
          <h3 id="ledger-heading">Anyone can read this</h3>
        </div>
        {view !== null && (
          <span className="status-badge status-connected" aria-live="polite">
            {view.phaseLabel}
          </span>
        )}
      </div>

      {view === null ? (
        <p className="privacy-note" aria-busy={!round.indexerLagging}>
          {round.indexerLagging
            ? 'The indexer has not answered for several attempts. It may be behind or unreachable; this keeps retrying.'
            : 'Waiting for the indexer to catch up with this contract…'}
        </p>
      ) : (
        <>
          <dl className="ledger-grid">
            <div>
              <dt>Registered reviewers</dt>
              <dd>{view.reviewerIdHexes.length}</dd>
            </div>
            <div>
              <dt>Enrollment leaves</dt>
              <dd>{view.enrollmentLeafCount}</dd>
            </div>
            <div>
              <dt>Applications</dt>
              <dd>{view.tallies.length}</dd>
            </div>
            <div>
              <dt>Sealed commitments</dt>
              <dd>{view.commitmentHexes.length}</dd>
            </div>
            <div>
              <dt>Replay nullifiers</dt>
              <dd>{view.nullifierCount}</dd>
            </div>
            <div>
              <dt>Eligibility rules</dt>
              <dd>
                income &le; {view.maxIncomeBand}, GPA &ge; {view.minGpaScaled}
              </dd>
            </div>
          </dl>

          {view.tallies.length > 0 && (
            <table className="tally-table">
              <caption>Publicly verifiable tally</caption>
              <thead>
                <tr>
                  <th scope="col">Application</th>
                  <th scope="col">Revealed sum</th>
                  <th scope="col">Reviewers</th>
                </tr>
              </thead>
              <tbody>
                {view.tallies.map((tally) => (
                  <tr key={tally.applicationIdHex}>
                    <td title={tally.applicationIdHex}>{shortenHex(tally.applicationIdHex)}</td>
                    <td>{tally.scoreSum ?? '—'}</td>
                    <td>{tally.revealedCount ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="privacy-note">
            Sums appear only after the reveal phase opens the commitments. Until then the ledger
            holds commitments and nullifiers, and no score.
          </p>
        </>
      )}
    </section>
  );
};
