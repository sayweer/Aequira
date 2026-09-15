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

export type LedgerMerkleTree = {
  firstFree(): bigint;
  findPathForLeaf(leaf: Uint8Array): unknown;
};

export type AequiraLedgerLike = {
  readonly phase: number;
  readonly roundId: Uint8Array;
  readonly adminAuthority: Uint8Array;
  readonly maxIncomeBand: bigint;
  readonly minGpaScaled: bigint;
  readonly applicantTree: LedgerMerkleTree;
  readonly applications: LedgerSet;
  readonly applyNullifiers: LedgerSet;
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

/**
 * One-way values this browser derives from its own private state. None of them
 * is a secret, and each is compared against the public ledger to say what this
 * browser can do next.
 */
export type LocalIdentity = {
  readonly adminIdHex: string;
  readonly applicantIdHex: string;
  /** The application pseudonym `apply` would publish; shown only once it has. */
  readonly applicationIdHex: string;
  readonly applyNullifierHex: string;
  /** The leaf rebuilt from the imported receipt, or null before one is imported. */
  readonly enrollmentLeafHex: string | null;
  readonly reviewerIdHex: string;
};

export type LocalStatus = {
  readonly applicantIdHex: string;
  /** This browser's application, once it is on the ledger. */
  readonly applicationIdHex: string | null;
  readonly enrolledOnChain: boolean;
  readonly hasApplied: boolean;
  readonly isAdmin: boolean;
  readonly isRegisteredReviewer: boolean;
  readonly receiptImported: boolean;
  readonly reviewerIdHex: string;
};

export type RoundView = {
  readonly phase: number;
  readonly phaseLabel: string;
  readonly roundIdHex: string;
  /** The eligibility rules the round announced. Fixed at deployment. */
  readonly maxIncomeBand: number;
  readonly minGpaScaled: number;
  /** Leaves the institution registered; a re-issued receipt adds one. */
  readonly enrollmentLeafCount: number;
  readonly reviewerIdHexes: readonly string[];
  readonly commitmentHexes: readonly string[];
  readonly nullifierCount: number;
  /** One entry per submitted application, straight from the ledger. */
  readonly tallies: readonly ApplicationTally[];
  /** Where this browser stands, or null when it holds no private state. */
  readonly local: LocalStatus | null;
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
const readTally = (ledger: AequiraLedgerLike, key: Uint8Array): ApplicationTally => ({
  applicationIdHex: bytesToHex(key),
  revealedCount: ledger.revealedCounts.member(key)
    ? Number(ledger.revealedCounts.lookup(key).read())
    : null,
  scoreSum: ledger.scoreSums.member(key) ? Number(ledger.scoreSums.lookup(key).read()) : null,
});

export const toLocalStatus = (ledger: AequiraLedgerLike, identity: LocalIdentity): LocalStatus => {
  const hasApplied = ledger.applyNullifiers.member(hexToBytes(identity.applyNullifierHex));

  return {
    applicantIdHex: identity.applicantIdHex,
    applicationIdHex: hasApplied ? identity.applicationIdHex : null,
    enrolledOnChain:
      identity.enrollmentLeafHex !== null &&
      ledger.applicantTree.findPathForLeaf(hexToBytes(identity.enrollmentLeafHex)) !== undefined,
    hasApplied,
    isAdmin: bytesToHex(ledger.adminAuthority) === identity.adminIdHex,
    isRegisteredReviewer: ledger.reviewers.member(hexToBytes(identity.reviewerIdHex)),
    receiptImported: identity.enrollmentLeafHex !== null,
    reviewerIdHex: identity.reviewerIdHex,
  };
};

/**
 * Application IDs are public by design — `apply` discloses each one — so the
 * tally lists every submitted application rather than only those this browser
 * happened to touch.
 */
export const toRoundView = (
  ledger: AequiraLedgerLike,
  identity: LocalIdentity | null = null,
): RoundView => ({
  commitmentHexes: [...ledger.scoreCommitments].map(bytesToHex),
  enrollmentLeafCount: Number(ledger.applicantTree.firstFree()),
  local: identity === null ? null : toLocalStatus(ledger, identity),
  maxIncomeBand: Number(ledger.maxIncomeBand),
  minGpaScaled: Number(ledger.minGpaScaled),
  nullifierCount: Number(ledger.scoreNullifiers.size()),
  phase: ledger.phase,
  phaseLabel: phaseLabel(ledger.phase),
  reviewerIdHexes: [...ledger.reviewers].map(bytesToHex),
  roundIdHex: bytesToHex(ledger.roundId),
  tallies: [...ledger.applications].map((key) => readTally(ledger, key)),
});
