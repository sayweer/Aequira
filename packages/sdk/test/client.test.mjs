import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { deriveReviewerId, validateAequiraPrivateState } from '../dist/index.js';

const bytes = (size = 32) => new Uint8Array(size);

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
