import type { AequiraRound } from '../hooks/useAequiraRound.js';
import { HexValue } from './HexValue.js';

type LedgerPanelProps = {
  readonly round: AequiraRound;
};

export const LedgerPanel = ({ round }: LedgerPanelProps) => {
  const { view } = round;

  return (
    <section className="panel ledger" aria-labelledby="ledger-heading">
      <header className="panel-header">
        <div>
          <p className="panel-label">Public ledger</p>
          <h2 className="panel-title" id="ledger-heading">
            What anyone can read
          </h2>
        </div>
        {view !== null && (
          <span className="chip" data-tone="neutral">
            Eligible: income band up to {view.maxIncomeBand}, grade{' '}
            {(view.minGpaScaled / 100).toFixed(2)} or higher
          </span>
        )}
      </header>

      {view === null ? (
        <p className="panel-text" aria-busy={!round.indexerLagging}>
          {round.indexerLagging
            ? 'The indexer has not answered for several attempts. It may be behind or unreachable; this keeps retrying.'
            : 'Waiting for the indexer to catch up with this contract…'}
        </p>
      ) : (
        <>
          <dl className="stats">
            <div>
              <dt>Reviewers</dt>
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
              <dt>Sealed scores</dt>
              <dd>{view.commitmentHexes.length}</dd>
            </div>
            <div>
              <dt>Scores cast</dt>
              <dd>{view.nullifierCount}</dd>
            </div>
          </dl>

          {view.tallies.length === 0 ? (
            <p className="panel-text">No applications yet.</p>
          ) : (
            <div className="table-scroll">
              <table className="tally-table">
                <caption>Tally, filled in as reviewers reveal</caption>
                <thead>
                  <tr>
                    <th scope="col">Application</th>
                    <th scope="col">Revealed sum</th>
                    <th scope="col">Reveals</th>
                  </tr>
                </thead>
                <tbody>
                  {view.tallies.map((tally) => (
                    <tr key={tally.applicationIdHex}>
                      <td>
                        <HexValue label="application ID" value={tally.applicationIdHex} />
                      </td>
                      <td className="numeric">{tally.scoreSum ?? '—'}</td>
                      <td className="numeric">{tally.revealedCount ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
};
