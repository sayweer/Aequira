import type { AequiraRound } from '../hooks/useAequiraRound.js';
import {
  buildRoundDisclosure,
  scoreStage,
  serializePublicLedger,
  type DisclosureRow,
} from '../privacy-view.js';

type PrivacyProofPanelProps = {
  readonly round: AequiraRound;
};

const LEDE = {
  none: 'Commit a score to see exactly which half of it becomes public.',
  opened:
    'This score was opened on purpose during reveal and now counts in the public tally. Until then, only its commitment was public.',
  pending:
    'The commitment below was computed in this browser. Waiting for the indexer to show it on chain.',
  sealed:
    'The commitment below was computed in this browser and is now on chain. The score that produced it is not.',
} as const;

const HEX_64 = /^[0-9a-f]{64}$/;

const Rows = ({ rows }: { readonly rows: readonly DisclosureRow[] }) => (
  <dl className="boundary-rows">
    {rows.map((row) => (
      <div key={row.label}>
        <dt>{row.label}</dt>
        <dd className={HEX_64.test(row.value) ? 'mono is-hex' : undefined} title={row.value}>
          {row.value}
        </dd>
        <p>{row.detail}</p>
      </div>
    ))}
  </dl>
);

export const PrivacyProofPanel = ({ round }: PrivacyProofPanelProps) => {
  const { lastScore, view } = round;

  if (view === null) {
    return null;
  }

  const stage = scoreStage(lastScore, view.commitmentHexes);
  const tally = view.tallies.find(
    (entry) => entry.applicationIdHex === lastScore?.applicationIdHex,
  );
  const disclosure = buildRoundDisclosure({
    applicationIdHex: lastScore?.applicationIdHex ?? null,
    commitmentHex: lastScore?.commitmentHex ?? null,
    maxIncomeBand: view.maxIncomeBand,
    minGpaScaled: view.minGpaScaled,
    nullifierHex: lastScore?.nullifierHex ?? null,
    phaseLabel: view.phaseLabel,
    revealedCount: tally?.revealedCount ?? null,
    roundIdHex: view.roundIdHex,
    score: lastScore?.score ?? null,
    scoreStage: stage,
    scoreSum: tally?.scoreSum ?? null,
  });

  return (
    <section className="boundary" aria-labelledby="boundary-heading">
      <div className="boundary-intro">
        <h2 id="boundary-heading">The proof travels. The score does not.</h2>
        <p>{LEDE[stage]}</p>
      </div>

      <div className="boundary-grid">
        <div className="boundary-side" data-scope="public">
          <h3>
            Public <span>what an observer reads</span>
          </h3>
          <Rows rows={disclosure.public} />
        </div>

        <div className="boundary-side" data-scope="local">
          <h3>
            <span className="seal-glyph" aria-hidden="true" />
            Local <span>what never leaves this browser</span>
          </h3>
          <Rows rows={disclosure.local} />
        </div>
      </div>

      <details className="observer-record">
        <summary>The public record, verbatim</summary>
        <pre>{serializePublicLedger(disclosure)}</pre>
        {stage === 'sealed' && lastScore !== null && (
          <p>
            Search this record for {lastScore.score}. It is not there, and it will not be until the
            reveal phase opens the commitment.
          </p>
        )}
      </details>
    </section>
  );
};
