import assert from 'node:assert/strict';
import test from 'node:test';

import { PHASE } from '../.test-build/round-actions.js';
import {
  currentRoundStep,
  ROUND_STEP_COUNT,
  roundStepPosition,
  roundSteps,
  unreachableRoundStep,
} from '../.test-build/round-steps.js';

const local = (overrides = {}) => ({
  applicantIdHex: 'aa'.repeat(32),
  applicationIdHex: null,
  enrolledOnChain: false,
  hasApplied: false,
  isAdmin: true,
  isRegisteredReviewer: false,
  receiptImported: false,
  reviewerIdHex: 'bb'.repeat(32),
  ...overrides,
});

// A ledger as `toRoundView` reports it. Empty is a round just deployed.
const ledger = (overrides = {}) => ({
  enrollmentLeafCount: 0,
  nullifierCount: 0,
  reviewerIdHexes: [],
  tallies: [],
  ...overrides,
});

const tally = (revealedCount = null) => ({
  applicationIdHex: 'cc'.repeat(32),
  revealedCount,
  scoreSum: revealedCount === null ? null : 84,
});

// Every setup step taken, by whichever browser took it.
const setUp = ledger({ enrollmentLeafCount: 1, reviewerIdHexes: ['bb'.repeat(32)] });

const input = (overrides = {}) => ({
  address: null,
  connected: false,
  ledger: null,
  lastScore: null,
  local: null,
  phase: null,
  ...overrides,
});

test('starts at the wallet and will not look past it', () => {
  assert.equal(currentRoundStep(input()).id, 'wallet');
  assert.equal(roundStepPosition('wallet'), 1);
});

test('asks for a round once the wallet is connected', () => {
  assert.equal(currentRoundStep(input({ connected: true })).id, 'round');
});

test('registers the reviewer before anything else in setup', () => {
  // The step that was skipped. Registration is setup-only and cannot be undone,
  // so it has to come before the transition that closes setup.
  const open = input({
    address: 'ab'.repeat(32),
    connected: true,
    ledger: ledger(),
    local: local(),
    phase: PHASE.SETUP,
  });

  assert.equal(currentRoundStep(open).id, 'register');
  assert.ok(roundStepPosition('register') < roundStepPosition('openApplications'));
});

test('walks setup in order: reviewer, enrollment, receipt, then the transition', () => {
  const at = (onLedger, status = {}) =>
    currentRoundStep(
      input({
        address: 'ab'.repeat(32),
        connected: true,
        ledger: ledger(onLedger),
        local: local(status),
        phase: PHASE.SETUP,
      }),
    ).id;
  const reviewer = { reviewerIdHexes: ['bb'.repeat(32)] };

  assert.equal(at(reviewer, { isRegisteredReviewer: true }), 'enrollment');
  assert.equal(at({ ...reviewer, enrollmentLeafCount: 1 }), 'receipt');
  assert.equal(
    at({ ...reviewer, enrollmentLeafCount: 1 }, { enrolledOnChain: true, receiptImported: true }),
    'openApplications',
  );
});

test('offers the receipt once the leaf is on chain, before this browser knows it is its own', () => {
  // The regression: this browser's leaf is only known after the receipt is
  // imported, and importing is the next step. Waiting for it kept the round on
  // the enrollment form forever. This is the status `toLocalStatus` reports
  // right after enrolling, with no receipt imported yet.
  const justEnrolled = input({
    address: 'ab'.repeat(32),
    connected: true,
    ledger: setUp,
    local: local({ enrolledOnChain: false, isRegisteredReviewer: true, receiptImported: false }),
    phase: PHASE.SETUP,
  });

  assert.equal(currentRoundStep(justEnrolled).id, 'receipt');
});

test('counts steps another participant took, so a joining browser follows the round', () => {
  // A browser that joined holds none of the organizer's or reviewer's secrets.
  const joined = local({ isAdmin: false });
  const at = (phase, onLedger) =>
    input({
      address: 'ab'.repeat(32),
      connected: true,
      ledger: onLedger,
      local: joined,
      phase,
    });

  assert.equal(currentRoundStep(at(PHASE.SETUP, setUp)).id, 'receipt');
  assert.equal(currentRoundStep(at(PHASE.REVIEW, { ...setUp, tallies: [tally()] })).id, 'commit');
  assert.equal(
    unreachableRoundStep(at(PHASE.REVEAL, { ...setUp, nullifierCount: 1, tallies: [tally()] })),
    null,
  );
  assert.equal(
    currentRoundStep(at(PHASE.REVEAL, { ...setUp, nullifierCount: 1, tallies: [tally(1)] })),
    null,
  );
});

test('keeps a sealed score done across a reload, when this tab has no record of it', () => {
  const reloaded = input({
    address: 'ab'.repeat(32),
    connected: true,
    lastScore: null,
    ledger: { ...setUp, nullifierCount: 1, tallies: [tally()] },
    local: local({ enrolledOnChain: true, hasApplied: true, receiptImported: true }),
    phase: PHASE.REVEAL,
  });

  assert.equal(unreachableRoundStep(reloaded), null);
  assert.equal(currentRoundStep(reloaded).id, 'reveal');
});

test('moves through the round as the phase and this browser advance', () => {
  const ready = { isRegisteredReviewer: true, enrolledOnChain: true, receiptImported: true };
  const at = (phase, status = {}, rest = {}) =>
    currentRoundStep(
      input({
        address: 'ab'.repeat(32),
        connected: true,
        ledger: setUp,
        local: local({ ...ready, ...status }),
        phase,
        ...rest,
      }),
    ).id;

  assert.equal(at(PHASE.APPLY), 'apply');
  assert.equal(at(PHASE.APPLY, { hasApplied: true }), 'openReview');
  assert.equal(at(PHASE.REVIEW, { hasApplied: true }), 'commit');
});

test('treats a committed score as done before the indexer catches up', () => {
  const sealed = {
    applicationIdHex: 'cc'.repeat(32),
    commitmentHex: 'dd'.repeat(32),
    nullifierHex: 'ee'.repeat(32),
    score: 84,
    stage: 'committed',
  };
  const at = (phase, lastScore) =>
    currentRoundStep(
      input({
        address: 'ab'.repeat(32),
        connected: true,
        lastScore,
        ledger: setUp,
        local: local({
          enrolledOnChain: true,
          hasApplied: true,
          isRegisteredReviewer: true,
          receiptImported: true,
        }),
        phase,
      }),
    );

  assert.equal(at(PHASE.REVIEW, sealed).id, 'openReveal');
  assert.equal(at(PHASE.REVEAL, sealed).id, 'reveal');
  assert.equal(at(PHASE.REVEAL, { ...sealed, stage: 'revealed' }), null);
});

test('reports every step with its own done flag, in a stable order', () => {
  const steps = roundSteps(input({ connected: true }));

  assert.equal(steps.length, ROUND_STEP_COUNT);
  assert.equal(steps[0].done, true);
  assert.equal(steps[1].done, false);
  assert.deepEqual(
    steps.map((step) => step.id),
    [
      'wallet',
      'round',
      'register',
      'enrollment',
      'receipt',
      'openApplications',
      'apply',
      'openReview',
      'commit',
      'openReveal',
      'reveal',
    ],
  );
  for (const step of steps) {
    assert.ok(step.title.length > 0);
    assert.ok(step.summary.length > 0);
  }
});

test('reports a round that can no longer be finished, naming the step that closed', () => {
  // Both rounds the hosted build left behind: no reviewer was registered and the
  // phase moved on, so registration can never happen and no score can follow.
  const open = (phase, onLedger = {}) =>
    unreachableRoundStep(
      input({
        address: 'ab'.repeat(32),
        connected: true,
        ledger: ledger(onLedger),
        local: local(),
        phase,
      }),
    );

  assert.equal(open(PHASE.APPLY)?.id, 'register');
  assert.equal(open(PHASE.REVEAL)?.id, 'register');
  assert.equal(open(PHASE.APPLY, { reviewerIdHexes: ['bb'.repeat(32)] })?.id, 'enrollment');
});

test('leaves a round alone while every deadline is still ahead of it', () => {
  const ready = { enrolledOnChain: true, isRegisteredReviewer: true, receiptImported: true };
  const at = (phase, status = {}) =>
    unreachableRoundStep(
      input({
        address: 'ab'.repeat(32),
        connected: true,
        ledger: setUp,
        local: local(status),
        phase,
      }),
    );

  assert.equal(at(PHASE.SETUP), null);
  assert.equal(
    unreachableRoundStep(
      input({ address: 'ab'.repeat(32), connected: true, ledger: ledger(), phase: PHASE.SETUP }),
    ),
    null,
  );
  assert.equal(at(PHASE.APPLY, ready), null);
  assert.equal(at(PHASE.REVIEW, { ...ready, hasApplied: true }), null);
  // Nothing is stranded before the ledger has been read.
  assert.equal(unreachableRoundStep(input({ connected: true })), null);
});

test('strands scoring when reveal opens with no sealed score', () => {
  const ready = {
    enrolledOnChain: true,
    hasApplied: true,
    isRegisteredReviewer: true,
    receiptImported: true,
  };

  assert.equal(
    unreachableRoundStep(
      input({
        address: 'ab'.repeat(32),
        connected: true,
        ledger: { ...setUp, tallies: [tally()] },
        local: local(ready),
        phase: PHASE.REVEAL,
      }),
    )?.id,
    'commit',
  );
});
