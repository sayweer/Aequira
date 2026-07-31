import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRoundDisclosure, serializePublicLedger } from '../.test-build/privacy-view.js';

// A commitment that contains no '93' substring, so the assertion below is about
// the score being withheld rather than about a coincidence.
const COMMITMENT = 'ab'.repeat(32);
const NULLIFIER = 'cd'.repeat(32);
const APPLICATION = 'a1'.repeat(32);
const ROUND = 'ef'.repeat(32);

const committed = (overrides = {}) => ({
  applicationIdHex: APPLICATION,
  commitmentHex: COMMITMENT,
  commitmentOnChain: true,
  nullifierHex: NULLIFIER,
  phaseLabel: 'Review',
  revealedCount: null,
  roundIdHex: ROUND,
  score: 93,
  scoreSum: null,
  ...overrides,
});

test('withholds the committed score from what an observer reads', () => {
  const blob = serializePublicLedger(buildRoundDisclosure(committed()));

  assert.ok(!blob.includes('93'), `the public view leaked the score: ${blob}`);
  assert.ok(blob.includes(COMMITMENT));
  assert.ok(blob.includes(NULLIFIER));
});

test('keeps every local value out of the public view', () => {
  const disclosure = buildRoundDisclosure(committed());
  const blob = serializePublicLedger(disclosure);

  for (const row of disclosure.local) {
    assert.ok(
      !blob.includes(row.value) || row.value === 'held in this browser',
      `${row.label} leaked into the public view`,
    );
  }

  // The score row in particular must never appear.
  const scoreRow = disclosure.local.find((row) => row.label === 'Score');
  assert.equal(scoreRow.value, '93');
  assert.ok(!blob.includes(scoreRow.value));
});

test('scopes each value to the side it belongs on', () => {
  const disclosure = buildRoundDisclosure(committed());

  assert.deepEqual(
    disclosure.local.map((row) => row.label),
    ['Score', 'Score salt', 'Reviewer secret', 'Administrator secret'],
  );
  assert.deepEqual(
    disclosure.public.map((row) => row.label),
    [
      'Round ID',
      'Phase',
      'Application ID',
      'Score commitment',
      'Replay nullifier',
      'Revealed score sum',
      'Revealed count',
    ],
  );
  assert.ok(disclosure.local.every((row) => row.scope === 'local'));
  assert.ok(disclosure.public.every((row) => row.scope === 'public'));
});

test('never places the salt or a secret value in a row', () => {
  const disclosure = buildRoundDisclosure(committed());

  for (const label of ['Score salt', 'Reviewer secret', 'Administrator secret']) {
    const row = disclosure.local.find((entry) => entry.label === label);
    assert.equal(row.value, 'held in this browser');
  }
});

test('reports the pre-commit state without inventing values', () => {
  const disclosure = buildRoundDisclosure(
    committed({
      applicationIdHex: null,
      commitmentHex: null,
      commitmentOnChain: false,
      nullifierHex: null,
      phaseLabel: 'Setup',
      score: null,
    }),
  );
  const blob = serializePublicLedger(disclosure);

  assert.match(blob, /not yet on chain/);
  assert.equal(disclosure.local.find((row) => row.label === 'Score').value, 'nothing entered yet');
});

test('distinguishes a commitment that is on chain from one that is not', () => {
  const pending = buildRoundDisclosure(committed({ commitmentOnChain: false })).public.find(
    (row) => row.label === 'Score commitment',
  );
  const settled = buildRoundDisclosure(committed()).public.find(
    (row) => row.label === 'Score commitment',
  );

  assert.match(pending.detail, /once the commit transaction is finalized/);
  assert.match(settled.detail, /now present in the on-chain commitment set/);
});

test('shows the revealed tally once reveals exist', () => {
  const blob = serializePublicLedger(
    buildRoundDisclosure(committed({ phaseLabel: 'Reveal', revealedCount: 2, scoreSum: 173 })),
  );

  assert.match(blob, /"Revealed score sum": "173"/);
  assert.match(blob, /"Revealed count": "2"/);
});

test('produces valid JSON for the observer panel', () => {
  const blob = serializePublicLedger(buildRoundDisclosure(committed()));

  assert.doesNotThrow(() => JSON.parse(blob));
  assert.equal(JSON.parse(blob).Phase, 'Review');
});
