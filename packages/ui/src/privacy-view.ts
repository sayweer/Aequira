// Builds the side-by-side disclosure view: what an observer reads from the
// ledger, and what stays in this browser.
//
// `serializePublicLedger` produces exactly the blob the page renders as "what an
// observer sees", which is why its test asserts the score is absent from it. The
// module never receives a secret: local rows describe where a value lives rather
// than carrying it, with the single exception of the score, which the user typed
// on this screen and which the assertion depends on.

export type DisclosureScope = 'local' | 'public';

export type DisclosureRow = {
  readonly detail: string;
  readonly label: string;
  readonly scope: DisclosureScope;
  readonly value: string;
};

export type RoundDisclosure = {
  readonly local: readonly DisclosureRow[];
  readonly public: readonly DisclosureRow[];
};

/** The score this tab last committed or revealed. The score itself never leaves the tab. */
export type LastScore = {
  readonly applicationIdHex: string;
  readonly commitmentHex: string;
  readonly nullifierHex: string;
  readonly score: number;
  readonly stage: 'committed' | 'revealed';
};

/**
 * Where the last score stands: nothing yet, committed but not yet indexed,
 * sealed in the on-chain commitment set, or opened during reveal (which removes
 * the commitment, so absence from the set no longer means "pending").
 */
export type ScoreStage = 'none' | 'opened' | 'pending' | 'sealed';

export const scoreStage = (
  lastScore: LastScore | null,
  commitmentHexes: readonly string[],
): ScoreStage => {
  if (lastScore === null) {
    return 'none';
  }
  if (lastScore.stage === 'revealed') {
    return 'opened';
  }
  return commitmentHexes.includes(lastScore.commitmentHex) ? 'sealed' : 'pending';
};

const COMMITMENT_DETAIL: Record<ScoreStage, string> = {
  none: 'Computed in this browser. It appears on chain once the commit transaction is finalized.',
  opened:
    'Opened during reveal and removed from the commitment set. The score now counts in the public tally.',
  pending:
    'Computed in this browser. It appears on chain once the commit transaction is finalized.',
  sealed:
    'Computed in this browser and now present in the on-chain commitment set. It binds the score without revealing it.',
};

export type RoundDisclosureInput = {
  readonly applicationIdHex: string | null;
  readonly commitmentHex: string | null;
  readonly nullifierHex: string | null;
  readonly scoreStage: ScoreStage;
  readonly phaseLabel: string;
  readonly revealedCount: number | null;
  readonly roundIdHex: string;
  /** The eligibility rules, fixed when the round was deployed. */
  readonly maxIncomeBand: number;
  readonly minGpaScaled: number;
  /** The score entered in this tab, or null before anything is committed. */
  readonly score: number | null;
  readonly scoreSum: number | null;
};

const NOT_YET = 'not yet on chain';

export const buildRoundDisclosure = (input: RoundDisclosureInput): RoundDisclosure => ({
  local: [
    {
      detail:
        input.scoreStage === 'opened'
          ? 'Revealed on purpose during the reveal phase. It now counts in the public tally.'
          : 'Entered in this tab. It is written to encrypted browser storage and read by the circuit as a witness. It is not in the transaction.',
      label: 'Score',
      scope: 'local',
      value: input.score === null ? 'nothing entered yet' : String(input.score),
    },
    {
      detail:
        'Derived from the reviewer secret for this application. Never displayed, never transmitted.',
      label: 'Score salt',
      scope: 'local',
      value: 'held in this browser',
    },
    {
      detail: 'Generated in this browser and encrypted at rest under the local storage password.',
      label: 'Reviewer secret',
      scope: 'local',
      value: 'held in this browser',
    },
    {
      detail:
        'A one-way hash of the reviewer secret. The organizer registered it during setup, so it is on the public roster — but the commit proves membership from a Merkle path instead of naming it, so it does not appear in this transaction.',
      label: 'Reviewer pseudonym',
      scope: 'local',
      value: 'held in this browser',
    },
    {
      detail: 'Authorizes phase transitions. Only its hash reached the ledger, as adminAuthority.',
      label: 'Administrator secret',
      scope: 'local',
      value: 'held in this browser',
    },
    {
      detail:
        'Income band, grade average and region, as the institution verified them and wrote them into the enrollment receipt. Applying proves they meet the rules without publishing them.',
      label: 'Applicant attributes',
      scope: 'local',
      value: 'held in this browser',
    },
    {
      detail:
        'Behind the applicant ID. It keeps the application pseudonym unlinkable to the enrollment, even for the institution that enrolled it.',
      label: 'Applicant secret',
      scope: 'local',
      value: 'held in this browser',
    },
  ],
  public: [
    {
      detail: 'The one-way round identifier recorded at deployment.',
      label: 'Round ID',
      scope: 'public',
      value: input.roundIdHex,
    },
    {
      detail: 'Anyone can read the current phase from the ledger.',
      label: 'Phase',
      scope: 'public',
      value: input.phaseLabel,
    },
    {
      detail: 'The public pseudonym of the application being scored.',
      label: 'Application ID',
      scope: 'public',
      value: input.applicationIdHex ?? NOT_YET,
    },
    {
      detail: COMMITMENT_DETAIL[input.scoreStage],
      label: 'Score commitment',
      scope: 'public',
      value: input.commitmentHex ?? NOT_YET,
    },
    {
      detail:
        'Prevents the same reviewer from scoring this application twice. It reveals no score.',
      label: 'Replay nullifier',
      scope: 'public',
      value: input.nullifierHex ?? NOT_YET,
    },
    {
      detail:
        'The commit proves the reviewer is on the roster by reconstructing this root from a private Merkle path. The root is the same for every reviewer, so it authorizes the score without recording which reviewer cast it.',
      label: 'Reviewer membership',
      scope: 'public',
      value: 'root matches; the acting reviewer is not recorded',
    },
    {
      detail:
        'Published with the round and unchangeable once it is open, so an application can be checked against the rules it was judged by. An applicant proves they clear these without publishing their income band or grade average.',
      label: 'Eligibility rules',
      scope: 'public',
      value: `income band at most ${input.maxIncomeBand}; grade average at least ${input.minGpaScaled} (x100)`,
    },
    {
      detail:
        'Zero until the reveal phase opens the commitment. This is the publicly verifiable tally.',
      label: 'Revealed score sum',
      scope: 'public',
      value: input.scoreSum === null ? 'no reveals yet' : String(input.scoreSum),
    },
    {
      detail: 'How many reviewers have opened their commitment for this application.',
      label: 'Revealed count',
      scope: 'public',
      value: input.revealedCount === null ? 'no reveals yet' : String(input.revealedCount),
    },
  ],
});

/**
 * Renders the public half as the observer would read it.
 *
 * Counts arrive from the ledger as bigint and are already converted to numbers
 * upstream, so this never has to serialize a bigint.
 */
export const serializePublicLedger = (disclosure: RoundDisclosure): string =>
  JSON.stringify(
    Object.fromEntries(disclosure.public.map((row) => [row.label, row.value])),
    null,
    2,
  );
