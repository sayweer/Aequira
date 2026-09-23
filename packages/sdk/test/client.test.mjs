import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  EnrollmentReceiptError,
  deriveAdminId,
  deriveApplicantId,
  deriveApplicantLeaf,
  deriveApplicationNonce,
  deriveApplicationPseudonym,
  deriveApplyNullifier,
  deriveEnrollmentLeaf,
  deriveReviewerId,
  deriveScoreCommitment,
  deriveScoreNullifier,
  deriveScoreSalt,
  formatEnrollmentReceipt,
  hasImportedEnrollment,
  issueEnrollmentReceipt,
  openEnrollmentReceipt,
  parseEnrollmentReceipt,
  validateAequiraPrivateState,
} from '../dist/index.js';

const bytes = (size = 32) => new Uint8Array(size);
const filled = (value) => new Uint8Array(32).fill(value);

const validPrivateState = () => ({
  adminSecret: bytes(),
  reviewerSecret: bytes(),
  score: 50n,
  scoreSalt: bytes(),
  applicantSecret: bytes(),
  applicantIncomeBand: 2n,
  applicantGpaScaled: 350n,
  applicantRegionCode: 7n,
  applicantSalt: bytes(),
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

  test('rejects applicant attributes wider than the circuit accepts', () => {
    // The witnesses are Uint<8>, Uint<16> and Uint<8>. Catching an overflow here
    // fails the call before a proof is attempted.
    assert.throws(
      () =>
        validateAequiraPrivateState({
          ...validPrivateState(),
          applicantIncomeBand: 256n,
        }),
      /applicantIncomeBand must be between 0 and 255/,
    );
    assert.throws(
      () =>
        validateAequiraPrivateState({
          ...validPrivateState(),
          applicantGpaScaled: 65536n,
        }),
      /applicantGpaScaled must be between 0 and 65535/,
    );
    assert.throws(
      () =>
        validateAequiraPrivateState({
          ...validPrivateState(),
          applicantSalt: bytes(31),
        }),
      /applicantSalt must contain exactly 32 bytes/,
    );
  });

  test('derives a deterministic reviewer pseudonym without exposing its secret', () => {
    const secret = new Uint8Array(32).fill(7);
    const reviewerId = deriveReviewerId(secret);

    assert.equal(reviewerId.byteLength, 32);
    assert.deepEqual(deriveReviewerId(secret), reviewerId);
    assert.notDeepEqual(reviewerId, secret);
  });

  test('derives a deterministic applicant pseudonym without exposing its secret', () => {
    const secret = new Uint8Array(32).fill(8);
    const applicantId = deriveApplicantId(secret);

    assert.equal(applicantId.byteLength, 32);
    assert.deepEqual(deriveApplicantId(secret), applicantId);
    assert.notDeepEqual(applicantId, secret);
  });
});

describe('AEQUIRA SDK applicant value derivation', () => {
  const roundId = filled(1);
  const applicantSecret = filled(5);
  const applicantSalt = filled(6);
  const nonce = filled(7);

  test('derives an enrollment leaf the same way the applicant device would, without the institution ever holding the secret', () => {
    const leaf = deriveApplicantLeaf(2n, 350n, 7n, applicantSecret, applicantSalt);

    assert.equal(leaf.byteLength, 32);
    assert.deepEqual(deriveApplicantLeaf(2n, 350n, 7n, applicantSecret, applicantSalt), leaf);
    assert.notDeepEqual(leaf, applicantSecret);
    assert.notDeepEqual(leaf, applicantSalt);
  });

  test('derives a leaf that changes with any single attribute or the salt', () => {
    const leaf = deriveApplicantLeaf(2n, 350n, 7n, applicantSecret, applicantSalt);

    assert.notDeepEqual(deriveApplicantLeaf(3n, 350n, 7n, applicantSecret, applicantSalt), leaf);
    assert.notDeepEqual(deriveApplicantLeaf(2n, 351n, 7n, applicantSecret, applicantSalt), leaf);
    assert.notDeepEqual(deriveApplicantLeaf(2n, 350n, 8n, applicantSecret, applicantSalt), leaf);
    assert.notDeepEqual(deriveApplicantLeaf(2n, 350n, 7n, applicantSecret, filled(9)), leaf);
  });

  test('rejects attributes wider than the circuit accepts', () => {
    assert.throws(
      () => deriveApplicantLeaf(256n, 350n, 7n, applicantSecret, applicantSalt),
      /incomeBand must be between 0 and 255/,
    );
    assert.throws(
      () => deriveApplicantLeaf(2n, 65536n, 7n, applicantSecret, applicantSalt),
      /gpaScaled must be between 0 and 65535/,
    );
    assert.throws(
      () => deriveApplicantLeaf(2n, 350n, 256n, applicantSecret, applicantSalt),
      /regionCode must be between 0 and 255/,
    );
  });

  test('derives a nullifier that is scoped to the round and the applicant', () => {
    const nullifier = deriveApplyNullifier(roundId, applicantSecret);

    assert.equal(nullifier.byteLength, 32);
    assert.deepEqual(deriveApplyNullifier(roundId, applicantSecret), nullifier);
    assert.notDeepEqual(deriveApplyNullifier(filled(9), applicantSecret), nullifier);
    assert.notDeepEqual(deriveApplyNullifier(roundId, filled(9)), nullifier);
  });

  test('derives a pseudonym that does not equal the nullifier and changes with the nonce', () => {
    const pseudonym = deriveApplicationPseudonym(roundId, applicantSecret, nonce);

    assert.equal(pseudonym.byteLength, 32);
    assert.notDeepEqual(pseudonym, deriveApplyNullifier(roundId, applicantSecret));
    assert.notDeepEqual(deriveApplicationPseudonym(roundId, applicantSecret, filled(9)), pseudonym);
  });
});

describe('AEQUIRA SDK enrollment receipts', () => {
  const roundId = filled(1);
  const applicantSecret = filled(5);
  const salt = filled(6);
  const hex = (value) => Buffer.from(value).toString('hex');
  const issue = (overrides = {}) =>
    issueEnrollmentReceipt({
      roundId,
      applicantId: deriveApplicantId(applicantSecret),
      incomeBand: 2n,
      gpaScaled: 350n,
      regionCode: 7n,
      salt,
      ...overrides,
    });
  const replacePart = (receipt, index, value) => {
    const parts = receipt.split(':');
    parts[index] = value;
    return parts.join(':');
  };
  // Values a leaked error message would expose.
  const assertNoPrivateEcho = (fn) => {
    assert.throws(fn, (error) => {
      assert.ok(error instanceof EnrollmentReceiptError, `unexpected ${error?.name}`);
      assert.doesNotMatch(error.message, new RegExp(hex(salt)));
      assert.doesNotMatch(error.message, /350/);
      return true;
    });
  };

  test('builds the institution leaf from the applicant ID to match the applicant own reconstruction', () => {
    assert.deepEqual(
      deriveEnrollmentLeaf(2n, 350n, 7n, deriveApplicantId(applicantSecret), salt),
      deriveApplicantLeaf(2n, 350n, 7n, applicantSecret, salt),
    );
  });

  test('issues a receipt that the enrolled applicant can open', () => {
    const { enrollmentLeaf, receipt } = issue();
    const opened = openEnrollmentReceipt(receipt, { roundId, applicantSecret });

    assert.match(receipt, /^aequira-enrollment:v1:/);
    assert.equal(opened.incomeBand, 2n);
    assert.equal(opened.gpaScaled, 350n);
    assert.equal(opened.regionCode, 7n);
    assert.deepEqual(opened.salt, salt);
    assert.deepEqual(opened.enrollmentLeaf, enrollmentLeaf);
  });

  test('round-trips through the text format, tolerating wrapped or padded pastes', () => {
    const { receipt } = issue();
    // Split inside the round ID, with the hex fields upper-cased.
    const wrapped = ` ${receipt.slice(0, 40)}\n  ${receipt.slice(40).toUpperCase()} \n`;

    assert.equal(formatEnrollmentReceipt(parseEnrollmentReceipt(receipt)), receipt);
    assert.deepEqual(parseEnrollmentReceipt(wrapped), parseEnrollmentReceipt(receipt));
  });

  test('refuses a receipt for another round, another applicant, or an altered value', () => {
    const { receipt } = issue();

    assertNoPrivateEcho(() =>
      openEnrollmentReceipt(receipt, { roundId: filled(2), applicantSecret }),
    );
    assertNoPrivateEcho(() =>
      openEnrollmentReceipt(receipt, { roundId, applicantSecret: filled(9) }),
    );
    assertNoPrivateEcho(() =>
      openEnrollmentReceipt(replacePart(receipt, 4, '1'), { roundId, applicantSecret }),
    );
  });

  test('refuses malformed receipts with messages that never echo them', () => {
    const { receipt } = issue();

    assertNoPrivateEcho(() => parseEnrollmentReceipt(`other:${receipt}`));
    assertNoPrivateEcho(() => parseEnrollmentReceipt(replacePart(receipt, 1, 'v2')));
    assertNoPrivateEcho(() => parseEnrollmentReceipt(`${receipt}:extra`));
    assertNoPrivateEcho(() => parseEnrollmentReceipt(replacePart(receipt, 4, '256')));
    assertNoPrivateEcho(() => parseEnrollmentReceipt(replacePart(receipt, 5, '0350')));
    assertNoPrivateEcho(() => parseEnrollmentReceipt(replacePart(receipt, 7, 'zz')));
    assertNoPrivateEcho(() => parseEnrollmentReceipt(replacePart(receipt, 7, '0'.repeat(64))));
  });

  test('refuses to issue a receipt with an empty salt', () => {
    assert.throws(() => issue({ salt: bytes() }), /salt must not be all zeros/);
  });

  test('treats an all-zero applicant salt as no receipt imported yet', () => {
    const state = { applicantSalt: bytes() };

    assert.equal(hasImportedEnrollment(state), false);
    assert.equal(hasImportedEnrollment({ applicantSalt: salt }), true);
  });

  test('derives the administrator authority from the round and the admin secret', () => {
    const adminId = deriveAdminId(roundId, filled(3));

    assert.equal(adminId.byteLength, 32);
    assert.deepEqual(deriveAdminId(roundId, filled(3)), adminId);
    assert.notDeepEqual(deriveAdminId(filled(2), filled(3)), adminId);
  });
});

describe('AEQUIRA SDK apply nonce derivation', () => {
  const roundId = filled(1);
  const applicantSecretA = filled(5);
  const applicantSecretB = filled(6);

  test('derives a 32-byte nonce', async () => {
    assert.equal((await deriveApplicationNonce(roundId, applicantSecretA)).byteLength, 32);
  });

  test('derives the same nonce again, so a future claim can reproduce the pseudonym', async () => {
    assert.deepEqual(
      await deriveApplicationNonce(roundId, applicantSecretA),
      await deriveApplicationNonce(roundId, applicantSecretA),
    );
  });

  test('derives a different nonce per round and per applicant', async () => {
    const nonce = await deriveApplicationNonce(roundId, applicantSecretA);

    assert.notDeepEqual(await deriveApplicationNonce(filled(9), applicantSecretA), nonce);
    assert.notDeepEqual(await deriveApplicationNonce(roundId, applicantSecretB), nonce);
  });

  test('never returns the applicant secret or the round ID verbatim', async () => {
    const nonce = await deriveApplicationNonce(roundId, applicantSecretA);

    assert.notDeepEqual(nonce, applicantSecretA);
    assert.notDeepEqual(nonce, roundId);
  });

  test('does not mutate its inputs', async () => {
    const secret = filled(5);
    await deriveApplicationNonce(roundId, secret);

    assert.deepEqual(secret, filled(5));
  });

  test('rejects inputs that are not 32 bytes', async () => {
    await assert.rejects(
      () => deriveApplicationNonce(bytes(31), applicantSecretA),
      /roundId must contain exactly 32 bytes/,
    );
    await assert.rejects(
      () => deriveApplicationNonce(roundId, bytes(33)),
      /applicantSecret must contain exactly 32 bytes/,
    );
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
    // commit twice by changing the value. The nullifier takes no score at
    // all, so the proof is that two different scores share it.
    const nullifier = deriveScoreNullifier(roundId, applicationId, reviewerSecret);
    const low = deriveScoreCommitment(roundId, applicationId, 50n, reviewerSecret, scoreSalt);
    const high = deriveScoreCommitment(roundId, applicationId, 51n, reviewerSecret, scoreSalt);

    assert.notDeepEqual(low, high);
    assert.notDeepEqual(low, nullifier);
    assert.notDeepEqual(high, nullifier);
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

  test('rejects a plain number before the runtime can quote it in an error', () => {
    // The Compact runtime's type error names the value it received, so a
    // private score must be refused here, where the message carries no value.
    assert.throws(
      () => deriveScoreCommitment(roundId, applicationId, 93, reviewerSecret, scoreSalt),
      (error) => /score must be a bigint/.test(error.message) && !error.message.includes('93'),
    );
    assert.throws(
      () => deriveEnrollmentLeaf(2, 350n, 7n, filled(5), filled(6)),
      /incomeBand must be a bigint/,
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
