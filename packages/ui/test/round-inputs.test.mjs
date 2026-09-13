import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseApplicantAttributes,
  parseApplicationId,
  parseContractAddressInput,
  parseEligibilityThresholds,
  parseEnrollmentLeaf,
  parseReviewerId,
  parseScore,
} from '../.test-build/round-inputs.js';

const VALID_HEX = 'a'.repeat(64);

test('normalizes application identifiers to unprefixed lowercase hex', () => {
  assert.equal(parseApplicationId(VALID_HEX), VALID_HEX);
  assert.equal(parseApplicationId(`0x${'A'.repeat(64)}`), 'a'.repeat(64));
  assert.equal(parseApplicationId(`  ${VALID_HEX}  `), VALID_HEX);
});

test('rejects application identifiers that are not exactly 32 bytes', () => {
  assert.throws(() => parseApplicationId('a'.repeat(63)), /64 hexadecimal/);
  assert.throws(() => parseApplicationId('a'.repeat(65)), /64 hexadecimal/);
  assert.throws(() => parseApplicationId(''), /Enter an application ID/);
  assert.throws(() => parseApplicationId('   '), /Enter an application ID/);
  assert.throws(() => parseApplicationId(`${'a'.repeat(62)}zz`), /64 hexadecimal/);
  assert.throws(() => parseApplicationId(`${'a'.repeat(32)} ${'a'.repeat(31)}`), /64 hexadecimal/);
});

test('reports reviewer identifiers under their own label', () => {
  assert.equal(parseReviewerId(VALID_HEX), VALID_HEX);
  assert.throws(() => parseReviewerId('abc'), /reviewer ID must be exactly 64/);
});

test('reports enrollment leaves under their own label', () => {
  assert.equal(parseEnrollmentLeaf(VALID_HEX), VALID_HEX);
  assert.throws(() => parseEnrollmentLeaf('abc'), /enrollment leaf must be exactly 64/);
});

test('accepts whole scores within the rubric range', () => {
  assert.equal(parseScore('0'), 0);
  assert.equal(parseScore('93'), 93);
  assert.equal(parseScore('100'), 100);
  assert.equal(parseScore(' 42 '), 42);
});

test('rejects scores outside the rubric range or shape', () => {
  for (const invalid of ['101', '999', '-1', '7.5', '', '   ', '1e2', 'ten', '0x10', '+5']) {
    assert.throws(
      () => parseScore(invalid),
      /score/,
      `expected ${JSON.stringify(invalid)} to fail`,
    );
  }
});

test('accepts a contract address and rejects malformed input', () => {
  const address = '0200a1b2c3d4e5f60718293a4b5c6d7e8f90';
  assert.equal(parseContractAddressInput(` ${address} `), address);
  assert.throws(() => parseContractAddressInput(''), /Enter a contract address/);
  assert.throws(() => parseContractAddressInput('0200a1'), /contract address/);
  assert.throws(() => parseContractAddressInput('0200a1b2c3d4 e5f60718293a4b'), /contract address/);
});

test('never echoes the rejected value, because these fields also carry scores', () => {
  const secretish = ['93', 'reviewer-secret-value', '0xdeadbeefdeadbeef'];

  for (const value of secretish) {
    for (const parse of [parseApplicationId, parseReviewerId, parseScore]) {
      try {
        parse(value);
      } catch (error) {
        assert.ok(
          !error.message.includes(value),
          `${parse.name} leaked ${JSON.stringify(value)} in: ${error.message}`,
        );
      }
    }
  }
});

test('parses the eligibility rules as the constructor takes them', () => {
  assert.deepEqual(parseEligibilityThresholds(' 3 ', '320'), {
    maxIncomeBand: 3n,
    minGpaScaled: 320n,
  });
  assert.deepEqual(parseEligibilityThresholds('0', '0'), {
    maxIncomeBand: 0n,
    minGpaScaled: 0n,
  });
});

test('refuses eligibility rules the contract could not store', () => {
  assert.throws(
    () => parseEligibilityThresholds('256', '320'),
    /maximum income band must be a whole number between 0 and 255/i,
  );
  assert.throws(() => parseEligibilityThresholds('3', '65536'), /between 0 and 65535/);
  assert.throws(() => parseEligibilityThresholds('', '320'), /Enter the maximum income band/);
  assert.throws(() => parseEligibilityThresholds('3', '3.2'), /whole number/);
});

test('parses an applicant’s attributes the same way apply’s witnesses take them', () => {
  assert.deepEqual(parseApplicantAttributes('2', '350', '7'), {
    incomeBand: 2n,
    gpaScaled: 350n,
    regionCode: 7n,
  });
  assert.deepEqual(parseApplicantAttributes('0', '0', '0'), {
    incomeBand: 0n,
    gpaScaled: 0n,
    regionCode: 0n,
  });
});

test('refuses applicant attributes wider than the circuit accepts', () => {
  assert.throws(
    () => parseApplicantAttributes('256', '350', '7'),
    /income band must be a whole number between 0 and 255/i,
  );
  assert.throws(
    () => parseApplicantAttributes('2', '65536', '7'),
    /grade average.*between 0 and 65535/i,
  );
  assert.throws(
    () => parseApplicantAttributes('2', '350', '256'),
    /region code must be a whole number between 0 and 255/i,
  );
  assert.throws(() => parseApplicantAttributes('', '350', '7'), /Enter the income band/);
});
