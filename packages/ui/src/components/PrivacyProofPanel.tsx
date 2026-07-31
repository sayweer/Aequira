import type { AequiraRound } from '../hooks/useAequiraRound.js';
import { buildRoundDisclosure, serializePublicLedger } from '../privacy-view.js';

type PrivacyProofPanelProps = {
  readonly round: AequiraRound;
};

export const PrivacyProofPanel = ({ round }: PrivacyProofPanelProps) => {
  const { lastCommitted, lastOpening, view } = round;

  if (view === null) {
    return null;
  }

  const tally = view.tallies.find(
    (entry) => entry.applicationIdHex === lastCommitted?.applicationIdHex,
  );
  const commitmentOnChain =
    lastOpening !== null && view.commitmentHexes.includes(lastOpening.commitmentHex);

  const disclosure = buildRoundDisclosure({
    applicationIdHex: lastCommitted?.applicationIdHex ?? null,
    commitmentHex: lastOpening?.commitmentHex ?? null,
    commitmentOnChain,
    nullifierHex: lastOpening?.nullifierHex ?? null,
    phaseLabel: view.phaseLabel,
    revealedCount: tally?.revealedCount ?? null,
    roundIdHex: view.roundIdHex,
    score: lastCommitted?.score ?? null,
    scoreSum: tally?.scoreSum ?? null,
  });

  return (
    <section className="disclosure-panel" aria-labelledby="disclosure-heading">
      <div className="boundary-intro">
        <p className="eyebrow">Privacy boundary</p>
        <h2 id="disclosure-heading">The proof travels. The score does not.</h2>
        {lastOpening !== null && (
          <p className="disclosure-lede">
            {commitmentOnChain
              ? 'The commitment below was computed in this browser and is now in the on-chain set. The score that produced it is not.'
              : 'The commitment below was computed in this browser. Waiting for the indexer to show it on chain.'}
          </p>
        )}
      </div>

      <div className="disclosure-columns">
        <div className="disclosure-column">
          <h3>
            <span className="boundary-label">Public</span> What an observer reads
          </h3>
          <dl>
            {disclosure.public.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd className="disclosure-value" title={row.value}>
                  {row.value}
                </dd>
                <p>{row.detail}</p>
              </div>
            ))}
          </dl>
        </div>

        <div className="disclosure-column is-local">
          <h3>
            <span className="boundary-label">Local</span> What never leaves this browser
          </h3>
          <dl>
            {disclosure.local.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd className="disclosure-value">{row.value}</dd>
                <p>{row.detail}</p>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <details className="observer-blob">
        <summary>The public record, verbatim</summary>
        <pre>{serializePublicLedger(disclosure)}</pre>
        {lastCommitted !== null && (
          <p className="privacy-note">
            Search this block for {lastCommitted.score}. It is not there, and it will not be until
            the reveal phase opens the commitment.
          </p>
        )}
      </details>
    </section>
  );
};
