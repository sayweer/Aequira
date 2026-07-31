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

export type RoundDisclosureInput = {
  readonly applicationIdHex: string | null;
  readonly commitmentHex: string | null;
  readonly commitmentOnChain: boolean;
  readonly nullifierHex: string | null;
  readonly phaseLabel: string;
  readonly revealedCount: number | null;
  readonly roundIdHex: string;
  /** The score entered in this tab, or null before anything is committed. */
  readonly score: number | null;
  readonly scoreSum: number | null;
};

const NOT_YET = 'not yet on chain';

export const buildRoundDisclosure = (input: RoundDisclosureInput): RoundDisclosure => ({
  local: [
    {
      detail:
        'Entered in this tab. It is written to encrypted browser storage and read by the circuit as a witness. It is not in the transaction.',
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
      detail: 'Authorizes phase transitions. Only its hash reached the ledger, as adminAuthority.',
      label: 'Administrator secret',
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
      detail: input.commitmentOnChain
        ? 'Computed in this browser and now present in the on-chain commitment set. It binds the score without revealing it.'
        : 'Computed in this browser. It appears on chain once the commit transaction is finalized.',
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
