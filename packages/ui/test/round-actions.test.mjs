import assert from 'node:assert/strict';
import test from 'node:test';

import { actionAvailability, focusRole, PHASE, phaseSteps } from '../.test-build/round-actions.js';

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

test('lets a rostered reviewer commit during review and anyone reveal during reveal', () => {
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
