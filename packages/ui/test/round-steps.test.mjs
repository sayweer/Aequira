import assert from 'node:assert/strict';
import test from 'node:test';

import { PHASE } from '../.test-build/round-actions.js';
import {
  currentRoundStep,
  ROUND_STEP_COUNT,
  roundStepPosition,
  roundSteps,
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

const input = (overrides = {}) => ({
  address: null,
  commitmentHexes: [],
  connected: false,
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
    local: local(),
    phase: PHASE.SETUP,
  });

  assert.equal(currentRoundStep(open).id, 'register');
  assert.ok(roundStepPosition('register') < roundStepPosition('openApplications'));
});

test('walks setup in order: reviewer, enrollment, receipt, then the transition', () => {
  const at = (status) =>
    currentRoundStep(
      input({
        address: 'ab'.repeat(32),
        connected: true,
        local: local(status),
        phase: PHASE.SETUP,
      }),
    ).id;

  assert.equal(at({ isRegisteredReviewer: true }), 'enrollment');
  assert.equal(at({ isRegisteredReviewer: true, enrolledOnChain: true }), 'receipt');
  assert.equal(
    at({ isRegisteredReviewer: true, enrolledOnChain: true, receiptImported: true }),
    'openApplications',
  );
});

test('moves through the round as the phase and this browser advance', () => {
  const ready = { isRegisteredReviewer: true, enrolledOnChain: true, receiptImported: true };
  const at = (phase, status = {}, rest = {}) =>
    currentRoundStep(
      input({
        address: 'ab'.repeat(32),
        connected: true,
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
        commitmentHexes: [],
        connected: true,
        lastScore,
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
