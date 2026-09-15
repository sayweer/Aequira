import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bytesToHex,
  hexToBytes,
  phaseLabel,
  shortenHex,
  toLocalStatus,
  toRoundView,
} from '../.test-build/round-format.js';

const APPLICATION_A = 'a1'.repeat(32);
const APPLICATION_B = 'b2'.repeat(32);
const ADMIN_ID = 'cd'.repeat(32);
const REVIEWER_ID = '11'.repeat(32);
const APPLY_NULLIFIER = '77'.repeat(32);
const ENROLLMENT_LEAF = '88'.repeat(32);

const identity = (overrides = {}) => ({
  adminIdHex: ADMIN_ID,
  applicantIdHex: '99'.repeat(32),
  applicationIdHex: APPLICATION_A,
  applyNullifierHex: APPLY_NULLIFIER,
  enrollmentLeafHex: ENROLLMENT_LEAF,
  reviewerIdHex: REVIEWER_ID,
  ...overrides,
});

/** Mirrors the generated ledger Set: iterable, with a byte-wise `member`. */
const createSet = (hexes) => {
  const values = hexes.map(hexToBytes);
  const has = (element) => values.some((value) => bytesToHex(value) === bytesToHex(element));

  return {
    isEmpty: () => values.length === 0,
    member: has,
    size: () => BigInt(values.length),
    [Symbol.iterator]: () => values[Symbol.iterator](),
  };
};

/**
 * Mirrors the generated ledger Map, including the important part: `lookup`
 * throws for an absent key instead of returning undefined.
 */
const createCounterMap = (entries) => ({
  isEmpty: () => Object.keys(entries).length === 0,
  lookup: (key) => {
    const hex = bytesToHex(key);
    if (!(hex in entries)) {
      throw new Error(`Map value undefined for ${hex}`);
    }
    return { read: () => BigInt(entries[hex]) };
  },
  member: (key) => bytesToHex(key) in entries,
  size: () => BigInt(Object.keys(entries).length),
});

/** Mirrors the generated MerkleTree: a path exists only for a registered leaf. */
const createTree = (leafHexes) => ({
  firstFree: () => BigInt(leafHexes.length),
  findPathForLeaf: (leaf) =>
    leafHexes.includes(bytesToHex(leaf)) ? { leaf, path: [] } : undefined,
});

const createLedger = (overrides = {}) => ({
  adminAuthority: hexToBytes('cd'.repeat(32)),
  applicantTree: createTree([]),
  applications: createSet([]),
  applyNullifiers: createSet([]),
  maxIncomeBand: 3n,
  minGpaScaled: 300n,
  phase: 2,
  revealedCounts: createCounterMap({}),
  reviewers: createSet([]),
  roundId: hexToBytes('ef'.repeat(32)),
  scoreCommitments: createSet([]),
  scoreNullifiers: createSet([]),
  scoreSums: createCounterMap({}),
  ...overrides,
});

test('hex encoding pads single-digit bytes', () => {
  assert.equal(bytesToHex(new Uint8Array([0, 10, 255])), '000aff');
  assert.equal(bytesToHex(new Uint8Array([])), '');
  assert.deepEqual(hexToBytes('000aff'), new Uint8Array([0, 10, 255]));
});

test('round-trips hex through bytes', () => {
  assert.equal(bytesToHex(hexToBytes(APPLICATION_A)), APPLICATION_A);
});

test('shortens long hex and leaves short hex alone', () => {
  assert.equal(shortenHex('abcdef'), 'abcdef');
  assert.equal(shortenHex(APPLICATION_A), 'a1a1a1a1a1…a1a1a1');
});

test('labels every declared phase and falls back for unknown values', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(phaseLabel), [
    'Setup',
    'Applications open',
    'Review',
    'Reveal',
    'Finalized',
    'Claimed',
  ]);
  assert.equal(phaseLabel(9), 'Unknown phase');
});

test('enumerates the ledger sets and counts nullifiers', () => {
  const view = toRoundView(
    createLedger({
      reviewers: createSet(['11'.repeat(32), '22'.repeat(32)]),
      scoreCommitments: createSet(['33'.repeat(32)]),
      scoreNullifiers: createSet(['44'.repeat(32), '55'.repeat(32), '66'.repeat(32)]),
    }),
  );

  assert.deepEqual(view.reviewerIdHexes, ['11'.repeat(32), '22'.repeat(32)]);
  assert.deepEqual(view.commitmentHexes, ['33'.repeat(32)]);
  assert.equal(view.nullifierCount, 3);
  assert.equal(view.phaseLabel, 'Review');
  assert.equal(view.roundIdHex, 'ef'.repeat(32));
});

test('carries the eligibility rules the round announced', () => {
  const view = toRoundView(createLedger({ maxIncomeBand: 4n, minGpaScaled: 275n }));

  assert.equal(view.maxIncomeBand, 4);
  assert.equal(view.minGpaScaled, 275);
});

test('reads a tally for an application that has revealed scores', () => {
  const view = toRoundView(
    createLedger({
      applications: createSet([APPLICATION_A]),
      revealedCounts: createCounterMap({ [APPLICATION_A]: 2 }),
      scoreSums: createCounterMap({ [APPLICATION_A]: 173 }),
    }),
  );

  assert.deepEqual(view.tallies, [
    { applicationIdHex: APPLICATION_A, revealedCount: 2, scoreSum: 173 },
  ]);
});

test('lists every submitted application, with nulls for one no one has revealed', () => {
  const view = toRoundView(
    createLedger({
      applications: createSet([APPLICATION_A, APPLICATION_B]),
      revealedCounts: createCounterMap({ [APPLICATION_A]: 1 }),
      scoreSums: createCounterMap({ [APPLICATION_A]: 93 }),
    }),
  );

  assert.deepEqual(view.tallies, [
    { applicationIdHex: APPLICATION_A, revealedCount: 1, scoreSum: 93 },
    { applicationIdHex: APPLICATION_B, revealedCount: null, scoreSum: null },
  ]);
});

test('produces a view that survives JSON serialization', () => {
  const view = toRoundView(
    createLedger({
      applications: createSet([APPLICATION_A]),
      reviewers: createSet(['11'.repeat(32)]),
      scoreSums: createCounterMap({ [APPLICATION_A]: 93 }),
    }),
    identity(),
  );

  // Counts arrive from the ledger as bigint; JSON.stringify throws on those, so
  // toRoundView has to convert them before the privacy panel renders anything.
  assert.doesNotThrow(() => JSON.stringify(view));
});

test('ignores the applications a stale browser might remember and trusts the ledger', () => {
  // Earlier builds kept application IDs in storage per network, so one round's
  // IDs leaked into the next. The view is built from the ledger alone now.
  const view = toRoundView(createLedger({ applications: createSet([APPLICATION_B]) }));

  assert.deepEqual(
    view.tallies.map((tally) => tally.applicationIdHex),
    [APPLICATION_B],
  );
});

test('counts the enrollment leaves the institution registered', () => {
  const view = toRoundView(
    createLedger({ applicantTree: createTree(['01'.repeat(32), '02'.repeat(32)]) }),
  );

  assert.equal(view.enrollmentLeafCount, 2);
});

test('places this browser in the round from one-way values only', () => {
  const ledger = createLedger({
    applicantTree: createTree([ENROLLMENT_LEAF]),
    applyNullifiers: createSet([APPLY_NULLIFIER]),
    reviewers: createSet([REVIEWER_ID]),
  });

  assert.deepEqual(toLocalStatus(ledger, identity()), {
    applicantIdHex: '99'.repeat(32),
    applicationIdHex: APPLICATION_A,
    enrolledOnChain: true,
    hasApplied: true,
    isAdmin: true,
    isRegisteredReviewer: true,
    receiptImported: true,
    reviewerIdHex: REVIEWER_ID,
  });
});

test('withholds the application ID until it is on the ledger, and reports a missing receipt', () => {
  const status = toLocalStatus(
    createLedger({ adminAuthority: hexToBytes('ee'.repeat(32)) }),
    identity({ enrollmentLeafHex: null }),
  );

  assert.equal(status.applicationIdHex, null);
  assert.equal(status.hasApplied, false);
  assert.equal(status.receiptImported, false);
  assert.equal(status.enrolledOnChain, false);
  assert.equal(status.isAdmin, false);
  assert.equal(status.isRegisteredReviewer, false);
});

test('attaches no local status when the browser holds no private state', () => {
  assert.equal(toRoundView(createLedger()).local, null);
});
