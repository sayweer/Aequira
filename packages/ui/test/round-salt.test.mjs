import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveScoreSalt } from '../.test-build/round-salt.js';

const filled = (value) => new Uint8Array(32).fill(value);

const ROUND = filled(1);
const APPLICATION_A = filled(2);
const APPLICATION_B = filled(3);
const SECRET = filled(4);

test('derives a 32-byte salt', async () => {
  assert.equal((await deriveScoreSalt(ROUND, APPLICATION_A, SECRET)).byteLength, 32);
});

test('derives the same salt again, so a reveal can reproduce the commitment', async () => {
  assert.deepEqual(
    await deriveScoreSalt(ROUND, APPLICATION_A, SECRET),
    await deriveScoreSalt(ROUND, APPLICATION_A, SECRET),
  );
});

test('derives a different salt per application, so scoring one does not break another', async () => {
  assert.notDeepEqual(
    await deriveScoreSalt(ROUND, APPLICATION_A, SECRET),
    await deriveScoreSalt(ROUND, APPLICATION_B, SECRET),
  );
});

test('derives a different salt per round and per reviewer', async () => {
  const salt = await deriveScoreSalt(ROUND, APPLICATION_A, SECRET);

  assert.notDeepEqual(await deriveScoreSalt(filled(9), APPLICATION_A, SECRET), salt);
  assert.notDeepEqual(await deriveScoreSalt(ROUND, APPLICATION_A, filled(9)), salt);
});

test('never returns the reviewer secret or any input verbatim', async () => {
  const salt = await deriveScoreSalt(ROUND, APPLICATION_A, SECRET);

  assert.notDeepEqual(salt, SECRET);
  assert.notDeepEqual(salt, ROUND);
  assert.notDeepEqual(salt, APPLICATION_A);
});

test('does not mutate its inputs', async () => {
  const secret = filled(4);
  await deriveScoreSalt(ROUND, APPLICATION_A, secret);

  assert.deepEqual(secret, filled(4));
});

test('rejects inputs that are not 32 bytes', async () => {
  await assert.rejects(
    () => deriveScoreSalt(new Uint8Array(31), APPLICATION_A, SECRET),
    /roundId must contain exactly 32 bytes/,
  );
  await assert.rejects(
    () => deriveScoreSalt(ROUND, APPLICATION_A, new Uint8Array(33)),
    /reviewerSecret must contain exactly 32 bytes/,
  );
});
