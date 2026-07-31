// Pure decoding of the public ledger into a renderable view.
//
// This module must not import any @midnight-ntwrk or @aequira package: it is
// compiled by tsconfig.test-build.json, which resolves neither the bundler-only
// specifiers nor the WASM those packages load. The ledger shapes below are
// therefore structural, and stay assignable from the generated `Ledger` type in
// packages/contract/src/managed/aequira/contract/index.d.ts.

export type LedgerSet = {
  size(): bigint;
  member(element: Uint8Array): boolean;
  [Symbol.iterator](): Iterator<Uint8Array>;
};

export type LedgerCounterMap = {
  size(): bigint;
  member(key: Uint8Array): boolean;
  lookup(key: Uint8Array): { read(): bigint };
};

export type AequiraLedgerLike = {
  readonly phase: number;
  readonly roundId: Uint8Array;
  readonly adminAuthority: Uint8Array;
  readonly reviewers: LedgerSet;
  readonly scoreNullifiers: LedgerSet;
  readonly scoreCommitments: LedgerSet;
  readonly scoreSums: LedgerCounterMap;
  readonly revealedCounts: LedgerCounterMap;
};

export type ApplicationTally = {
  readonly applicationIdHex: string;
  /** null when the application has no revealed score yet. */
  readonly scoreSum: number | null;
  readonly revealedCount: number | null;
};

export type RoundView = {
  readonly phase: number;
  readonly phaseLabel: string;
  readonly roundIdHex: string;
  readonly reviewerIdHexes: readonly string[];
  readonly commitmentHexes: readonly string[];
  readonly nullifierCount: number;
  readonly tallies: readonly ApplicationTally[];
};

export const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

export const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};

export const shortenHex = (hex: string): string =>
  hex.length <= 20 ? hex : `${hex.slice(0, 10)}…${hex.slice(-6)}`;

const PHASE_LABELS = ['Setup', 'Applications open', 'Review', 'Reveal', 'Finalized', 'Claimed'];

export const phaseLabel = (phase: number): string => PHASE_LABELS[phase] ?? 'Unknown phase';

/**
 * Reads one application's tally.
 *
 * `lookup` throws for an absent key rather than returning undefined, so every
 * read is guarded by `member` first.
 */
const readTally = (ledger: AequiraLedgerLike, applicationIdHex: string): ApplicationTally => {
  const key = hexToBytes(applicationIdHex);

  return {
    applicationIdHex,
    revealedCount: ledger.revealedCounts.member(key)
      ? Number(ledger.revealedCounts.lookup(key).read())
      : null,
    scoreSum: ledger.scoreSums.member(key) ? Number(ledger.scoreSums.lookup(key).read()) : null,
  };
};

/**
 * Sets are iterable; `scoreSums` and `revealedCounts` are not, so per-application
 * results can only be produced for identifiers the caller already knows. That is
 * not a privacy loss: `revealScore` discloses the application ID by design.
 */
export const toRoundView = (
  ledger: AequiraLedgerLike,
  knownApplicationIdHexes: readonly string[],
): RoundView => ({
  commitmentHexes: [...ledger.scoreCommitments].map(bytesToHex),
  nullifierCount: Number(ledger.scoreNullifiers.size()),
  phase: ledger.phase,
  phaseLabel: phaseLabel(ledger.phase),
  reviewerIdHexes: [...ledger.reviewers].map(bytesToHex),
  roundIdHex: bytesToHex(ledger.roundId),
  tallies: knownApplicationIdHexes.map((applicationIdHex) => readTally(ledger, applicationIdHex)),
});
