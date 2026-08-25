import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  deriveReviewerId,
  deriveScoreCommitment,
  deriveScoreNullifier,
  deriveScoreSalt,
  validateAequiraPrivateState,
} from '../dist/index.js';

const bytes = (size = 32) => new Uint8Array(size);
const filled = (value) => new Uint8Array(32).fill(value);

const validPrivateState = () => ({
  adminSecret: bytes(),
  reviewerSecret: bytes(),
  score: 50n,
  scoreSalt: bytes(),
});

describe('AEQUIRA SDK input validation', () => {
  test('accepts a complete private state', () => {
    assert.doesNotThrow(() => validateAequiraPrivateState(validPrivateState()));
  });

  test('rejects malformed 32-byte secret inputs', () => {
    assert.throws(
      () =>
        validateAequiraPrivateState({
          ...validPrivateState(),
          reviewerSecret: bytes(31),
        }),
      /reviewerSecret must contain exactly 32 bytes/,
    );
  });

  test('rejects scores outside the contract range', () => {
    assert.throws(
      () =>
        validateAequiraPrivateState({
          ...validPrivateState(),
          score: 101n,
        }),
      /score must be between 0 and 100/,
    );
  });

  test('derives a deterministic reviewer pseudonym without exposing its secret', () => {
    const secret = new Uint8Array(32).fill(7);
    const reviewerId = deriveReviewerId(secret);

    assert.equal(reviewerId.byteLength, 32);
    assert.deepEqual(deriveReviewerId(secret), reviewerId);
    assert.notDeepEqual(reviewerId, secret);
  });
});

describe('AEQUIRA SDK public value derivation', () => {
  const roundId = filled(1);
  const applicationId = filled(2);
  const reviewerSecret = filled(3);
  const scoreSalt = filled(4);

  test('derives a nullifier that is scoped to the application', () => {
    const nullifier = deriveScoreNullifier(roundId, applicationId, reviewerSecret);

    assert.equal(nullifier.byteLength, 32);
    assert.deepEqual(deriveScoreNullifier(roundId, applicationId, reviewerSecret), nullifier);
    assert.notDeepEqual(deriveScoreNullifier(roundId, filled(9), reviewerSecret), nullifier);
    assert.notDeepEqual(deriveScoreNullifier(filled(9), applicationId, reviewerSecret), nullifier);
  });

  test('derives a nullifier that does not depend on the score', () => {
    // The nullifier must be stable across scores, otherwise a reviewer could
    // commit twice by changing the value.
    const commitment = deriveScoreCommitment(
      roundId,
      applicationId,
      50n,
      reviewerSecret,
      scoreSalt,
    );

    assert.notDeepEqual(commitment, deriveScoreNullifier(roundId, applicationId, reviewerSecret));
  });

  test('derives a commitment that changes with the score and with the salt', () => {
    const commitment = deriveScoreCommitment(
      roundId,
      applicationId,
      93n,
      reviewerSecret,
      scoreSalt,
    );

    assert.equal(commitment.byteLength, 32);
    assert.deepEqual(
      deriveScoreCommitment(roundId, applicationId, 93n, reviewerSecret, scoreSalt),
      commitment,
    );
    assert.notDeepEqual(
      deriveScoreCommitment(roundId, applicationId, 94n, reviewerSecret, scoreSalt),
      commitment,
    );
    assert.notDeepEqual(
      deriveScoreCommitment(roundId, applicationId, 93n, reviewerSecret, filled(9)),
      commitment,
    );
  });

  test('reveals nothing about the score through the commitment bytes', () => {
    const commitment = deriveScoreCommitment(
      roundId,
      applicationId,
      93n,
      reviewerSecret,
      scoreSalt,
    );

    assert.notDeepEqual(commitment, scoreSalt);
    assert.notDeepEqual(commitment, reviewerSecret);
    assert.ok(!commitment.includes(93));
  });

  test('rejects malformed derivation inputs', () => {
    assert.throws(
      () => deriveScoreNullifier(bytes(31), applicationId, reviewerSecret),
      /roundId must contain exactly 32 bytes/,
    );
    assert.throws(
      () => deriveScoreCommitment(roundId, applicationId, 93n, reviewerSecret, bytes(31)),
      /scoreSalt must contain exactly 32 bytes/,
    );
    assert.throws(
      () => deriveScoreCommitment(roundId, applicationId, 101n, reviewerSecret, scoreSalt),
      /score must be between 0 and 100/,
    );
  });
});

describe('AEQUIRA SDK score salt derivation', () => {
  const roundId = filled(1);
  const applicationA = filled(2);
  const applicationB = filled(3);
  const reviewerSecret = filled(4);

  test('derives a 32-byte salt', async () => {
    assert.equal((await deriveScoreSalt(roundId, applicationA, reviewerSecret)).byteLength, 32);
  });

  test('derives the same salt again, so a reveal can reproduce the commitment', async () => {
    assert.deepEqual(
      await deriveScoreSalt(roundId, applicationA, reviewerSecret),
      await deriveScoreSalt(roundId, applicationA, reviewerSecret),
    );
  });

  test('derives a different salt per application, so scoring one does not break another', async () => {
    // This is the regression case for a real bug: a random-per-commit salt
    // (rather than one derived from applicationId) silently strands the
    // reveal of any application scored earlier by the same reviewer, once a
    // second application is scored.
    assert.notDeepEqual(
      await deriveScoreSalt(roundId, applicationA, reviewerSecret),
      await deriveScoreSalt(roundId, applicationB, reviewerSecret),
    );
  });

  test('derives a different salt per round and per reviewer', async () => {
    const salt = await deriveScoreSalt(roundId, applicationA, reviewerSecret);

    assert.notDeepEqual(await deriveScoreSalt(filled(9), applicationA, reviewerSecret), salt);
    assert.notDeepEqual(await deriveScoreSalt(roundId, applicationA, filled(9)), salt);
  });

  test('never returns the reviewer secret or any input verbatim', async () => {
    const salt = await deriveScoreSalt(roundId, applicationA, reviewerSecret);

    assert.notDeepEqual(salt, reviewerSecret);
    assert.notDeepEqual(salt, roundId);
    assert.notDeepEqual(salt, applicationA);
  });

  test('does not mutate its inputs', async () => {
    const secret = filled(4);
    await deriveScoreSalt(roundId, applicationA, secret);

    assert.deepEqual(secret, filled(4));
  });

  test('rejects inputs that are not 32 bytes', async () => {
    await assert.rejects(
      () => deriveScoreSalt(bytes(31), applicationA, reviewerSecret),
      /roundId must contain exactly 32 bytes/,
    );
    await assert.rejects(
      () => deriveScoreSalt(roundId, applicationA, bytes(33)),
      /reviewerSecret must contain exactly 32 bytes/,
    );
  });
});
