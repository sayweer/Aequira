import assert from 'node:assert/strict';
import test from 'node:test';

import {
  actionAvailability,
  focusRole,
  PHASE,
  phaseSteps,
  revealRejection,
} from '../.test-build/round-actions.js';

const status = (overrides = {}) => ({
  applicantIdHex: 'aa'.repeat(32),
  applicationIdHex: null,
  enrolledOnChain: true,
  hasApplied: false,
  isAdmin: true,
  isRegisteredReviewer: true,
  receiptImported: true,
  reviewerIdHex: 'bb'.repeat(32),
  ...overrides,
});

const at = (phase, local = status(), busy = false) => ({ busy, local, phase });

test('marks each reachable phase as done, current or upcoming', () => {
  assert.deepEqual(
    phaseSteps(PHASE.REVIEW).map((step) => `${step.label}:${step.state}`),
    ['Setup:done', 'Applications:done', 'Review:current', 'Reveal:upcoming'],
  );
  assert.ok(phaseSteps(null).every((step) => step.state === 'upcoming'));
});

test('focuses the role each phase is waiting on', () => {
  assert.deepEqual([PHASE.SETUP, PHASE.APPLY, PHASE.REVIEW, PHASE.REVEAL, null].map(focusRole), [
    'organizer',
    'applicant',
    'reviewer',
    'reviewer',
    'organizer',
  ]);
});

test('lets only the administrator register, and only during setup', () => {
  assert.equal(actionAvailability('registerReviewer', at(PHASE.SETUP)).enabled, true);
  assert.equal(actionAvailability('registerApplicant', at(PHASE.SETUP)).enabled, true);
  assert.match(
    actionAvailability('registerApplicant', at(PHASE.SETUP, status({ isAdmin: false }))).reason,
    /Only the wallet that deployed/,
  );
  assert.match(
    actionAvailability('registerReviewer', at(PHASE.APPLY)).reason,
    /Registration closes/,
  );
});

test('offers a phase transition to the administrator until the last phase', () => {
  assert.equal(actionAvailability('advance', at(PHASE.REVIEW)).enabled, true);
  assert.match(actionAvailability('advance', at(PHASE.REVEAL)).reason, /last phase/);
  assert.equal(
    actionAvailability('advance', at(PHASE.SETUP, status({ isAdmin: false }))).enabled,
    false,
  );
});

test('explains exactly what blocks an application', () => {
  assert.equal(actionAvailability('apply', at(PHASE.APPLY)).enabled, true);

  const cases = [
    [at(PHASE.SETUP), /open after setup/],
    [at(PHASE.REVIEW), /closed/],
    [
      at(PHASE.APPLY, status({ receiptImported: false, enrolledOnChain: false })),
      /Import the enrollment receipt/,
    ],
    [at(PHASE.APPLY, status({ enrolledOnChain: false })), /not on chain yet/],
    [at(PHASE.APPLY, status({ hasApplied: true })), /already applied/],
  ];

  for (const [input, reason] of cases) {
    const availability = actionAvailability('apply', input);
    assert.equal(availability.enabled, false);
    assert.match(availability.reason, reason);
  }
});

test('accepts a receipt until the applicant applies or review opens', () => {
  assert.equal(actionAvailability('importReceipt', at(PHASE.SETUP)).enabled, true);
  assert.equal(actionAvailability('importReceipt', at(PHASE.APPLY)).enabled, true);
  assert.match(actionAvailability('importReceipt', at(PHASE.REVIEW)).reason, /review opened/);
  assert.match(
    actionAvailability('importReceipt', at(PHASE.APPLY, status({ hasApplied: true }))).reason,
    /already applied/,
  );
});

test('gates both commit and reveal on the roster, each in its own phase', () => {
  assert.equal(actionAvailability('commit', at(PHASE.REVIEW)).enabled, true);
  assert.match(
    actionAvailability('commit', at(PHASE.REVIEW, status({ isRegisteredReviewer: false }))).reason,
    /not on the roster/,
  );
  assert.match(actionAvailability('commit', at(PHASE.APPLY)).reason, /opens with review/);
  assert.match(actionAvailability('commit', at(PHASE.REVEAL)).reason, /closed when reveal/);
  assert.equal(actionAvailability('reveal', at(PHASE.REVEAL)).enabled, true);
  assert.match(actionAvailability('reveal', at(PHASE.REVIEW)).reason, /during reveal/);
});

test('disables everything without a reason while another action runs', () => {
  for (const action of ['advance', 'apply', 'commit', 'importReceipt', 'registerReviewer']) {
    assert.deepEqual(actionAvailability(action, at(PHASE.APPLY, status(), true)), {
      enabled: false,
      reason: null,
    });
  }
});

test('waits for the ledger and for private state before offering anything', () => {
  assert.match(actionAvailability('apply', at(null)).reason, /public ledger/);
  assert.match(actionAvailability('apply', at(PHASE.APPLY, null)).reason, /no secrets/);
});

test('says nothing can open a score this browser never sealed', () => {
  // The state the hosted round reached: nobody was registered as a reviewer, so
  // the round advanced to reveal with no commitment on chain and every score
  // was refused. Reporting a wrong score there is a dead end.
  const message = revealRejection({
    commitmentRemains: false,
    hasSealedScore: false,
    scoreOpensCommitment: false,
  });

  assert.match(message, /no sealed score/);
  assert.match(message, /no score will work/);
  assert.match(message, /registered while the round is in setup/);
  assert.doesNotMatch(message, /does not open the commitment/);
});

test('keeps the wrong-score message for a score that really is wrong', () => {
  assert.match(
    revealRejection({ commitmentRemains: true, hasSealedScore: true, scoreOpensCommitment: false }),
    /does not open the commitment recorded on chain/,
  );
  assert.equal(
    revealRejection({ commitmentRemains: true, hasSealedScore: true, scoreOpensCommitment: true }),
    null,
  );
});

test('says a score was already opened rather than that it is wrong', () => {
  // Reveal removes the commitment and leaves the nullifier, so a second
  // attempt used to be reported as a wrong score, whatever score was tried.
  const message = revealRejection({
    commitmentRemains: false,
    hasSealedScore: true,
    scoreOpensCommitment: false,
  });

  assert.match(message, /already been opened/);
  assert.doesNotMatch(message, /does not open the commitment/);
});

test('does not offer reveal to a browser that is not on the reviewer roster', () => {
  assert.equal(actionAvailability('reveal', at(PHASE.REVEAL)).enabled, true);

  const offRoster = actionAvailability(
    'reveal',
    at(PHASE.REVEAL, status({ isRegisteredReviewer: false })),
  );

  assert.equal(offRoster.enabled, false);
  assert.match(offRoster.reason, /not on the roster/);
});
