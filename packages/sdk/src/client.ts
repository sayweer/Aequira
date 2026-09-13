import {
  compiledAequiraContract,
  ledger,
  pureCircuits,
  type AequiraPrivateState,
  type Ledger,
} from '@aequira/contract';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';

import {
  AEQUIRA_PRIVATE_STATE_ID,
  type AequiraContract,
  type AequiraProviders,
  type FoundAequiraContract,
} from './types.js';

const BYTE_LENGTH = 32;

const MAX_UINT8 = 255n;
const MAX_UINT16 = 65535n;

const assertBytes32 = (name: string, value: Uint8Array): void => {
  if (value.byteLength !== BYTE_LENGTH) {
    throw new RangeError(`${name} must contain exactly ${BYTE_LENGTH} bytes`);
  }
};

const assertUintRange = (name: string, value: bigint, maximum: bigint): void => {
  if (value < 0n || value > maximum) {
    throw new RangeError(`${name} must be between 0 and ${maximum}`);
  }
};

export const validateAequiraPrivateState = (privateState: AequiraPrivateState): void => {
  assertBytes32('adminSecret', privateState.adminSecret);
  assertBytes32('reviewerSecret', privateState.reviewerSecret);
  assertBytes32('scoreSalt', privateState.scoreSalt);
  assertBytes32('applicantSecret', privateState.applicantSecret);
  assertBytes32('applicantSalt', privateState.applicantSalt);

  if (privateState.score < 0n || privateState.score > 100n) {
    throw new RangeError('score must be between 0 and 100');
  }

  // The circuit's own witness types are Uint<8>, Uint<16> and Uint<8>. Catching
  // an out-of-range attribute here fails the call before a proof is attempted.
  assertUintRange('applicantIncomeBand', privateState.applicantIncomeBand, MAX_UINT8);
  assertUintRange('applicantGpaScaled', privateState.applicantGpaScaled, MAX_UINT16);
  assertUintRange('applicantRegionCode', privateState.applicantRegionCode, MAX_UINT8);
};

export const deriveReviewerId = (reviewerSecret: Uint8Array): Uint8Array => {
  assertBytes32('reviewerSecret', reviewerSecret);
  return Uint8Array.from(pureCircuits.reviewerId(reviewerSecret));
};

/**
 * Recomputes the public replay nullifier for a score.
 *
 * Callers use this to predict what a `commitScore` call will publish, without
 * building a transaction.
 */
export const deriveScoreNullifier = (
  roundId: Uint8Array,
  applicationId: Uint8Array,
  reviewerSecret: Uint8Array,
): Uint8Array => {
  assertBytes32('roundId', roundId);
  assertBytes32('applicationId', applicationId);
  assertBytes32('reviewerSecret', reviewerSecret);

  return Uint8Array.from(pureCircuits.scoreNullifier(roundId, applicationId, reviewerSecret));
};

/**
 * Recomputes the salted score commitment.
 *
 * This is the value that becomes public during REVIEW, and the same value
 * `revealScore` must reproduce to open it. Computing it locally lets a caller
 * check an opening against the ledger before spending a proof on it.
 */
export const deriveScoreCommitment = (
  roundId: Uint8Array,
  applicationId: Uint8Array,
  score: bigint,
  reviewerSecret: Uint8Array,
  scoreSalt: Uint8Array,
): Uint8Array => {
  assertBytes32('roundId', roundId);
  assertBytes32('applicationId', applicationId);
  assertBytes32('reviewerSecret', reviewerSecret);
  assertBytes32('scoreSalt', scoreSalt);

  if (score < 0n || score > 100n) {
    throw new RangeError('score must be between 0 and 100');
  }

  return Uint8Array.from(
    pureCircuits.scoreCommitment(roundId, applicationId, score, reviewerSecret, scoreSalt),
  );
};

export type DeployAequiraOptions = {
  readonly roundId: Uint8Array;
  readonly privateState: AequiraPrivateState;
  /**
   * The eligibility rules. They are constructor arguments rather than a later
   * admin call so that the criteria a round announces are fixed before it can
   * take a single application.
   */
  readonly maxIncomeBand: bigint;
  readonly minGpaScaled: bigint;
};

export const deployAequira = async (
  providers: AequiraProviders,
  options: DeployAequiraOptions,
): Promise<FoundAequiraContract> => {
  assertBytes32('roundId', options.roundId);
  assertUintRange('maxIncomeBand', options.maxIncomeBand, MAX_UINT8);
  assertUintRange('minGpaScaled', options.minGpaScaled, MAX_UINT16);
  validateAequiraPrivateState(options.privateState);

  const deployed = await deployContract<AequiraContract>(providers, {
    compiledContract: compiledAequiraContract,
    privateStateId: AEQUIRA_PRIVATE_STATE_ID,
    initialPrivateState: options.privateState,
    args: [
      options.roundId,
      options.privateState.adminSecret,
      options.maxIncomeBand,
      options.minGpaScaled,
    ],
  });

  providers.privateStateProvider.setContractAddress(deployed.deployTxData.public.contractAddress);

  return deployed;
};

export type JoinAequiraOptions = {
  readonly contractAddress: ContractAddress;
  readonly initialPrivateState?: AequiraPrivateState;
};

export const joinAequira = async (
  providers: AequiraProviders,
  options: JoinAequiraOptions,
): Promise<FoundAequiraContract> => {
  if (options.initialPrivateState !== undefined) {
    validateAequiraPrivateState(options.initialPrivateState);
  }

  const commonOptions = {
    compiledContract: compiledAequiraContract,
    contractAddress: options.contractAddress,
    privateStateId: AEQUIRA_PRIVATE_STATE_ID,
  };

  const found =
    options.initialPrivateState === undefined
      ? await findDeployedContract<AequiraContract>(providers, commonOptions)
      : await findDeployedContract<AequiraContract>(providers, {
          ...commonOptions,
          initialPrivateState: options.initialPrivateState,
        });

  providers.privateStateProvider.setContractAddress(options.contractAddress);

  return found;
};

export const setAequiraPrivateState = async (
  providers: AequiraProviders,
  contractAddress: ContractAddress,
  privateState: AequiraPrivateState,
): Promise<void> => {
  validateAequiraPrivateState(privateState);
  providers.privateStateProvider.setContractAddress(contractAddress);
  await providers.privateStateProvider.set(AEQUIRA_PRIVATE_STATE_ID, privateState);
};

export const queryAequiraLedger = async (
  providers: AequiraProviders,
  contractAddress: ContractAddress,
): Promise<Ledger | null> => {
  const contractState = await providers.publicDataProvider.queryContractState(contractAddress);

  return contractState === null ? null : ledger(contractState.data);
};

/**
 * Reads the round's public `roundId` off the ledger.
 *
 * Both `commitScore` and `revealScore` need this to derive a per-application
 * score salt (see {@link deriveScoreSalt}) — reading it from one place keeps
 * callers from disagreeing about where it comes from.
 */
export const readRoundId = async (
  providers: AequiraProviders,
  contractAddress: ContractAddress,
): Promise<Uint8Array> => {
  const ledgerState = await queryAequiraLedger(providers, contractAddress);

  if (ledgerState === null) {
    throw new Error('The indexer has not seen that contract address yet');
  }

  return Uint8Array.from(ledgerState.roundId);
};

const SCORE_SALT_DOMAIN = 'aequira:ui-salt:v1';

/**
 * Derives the score salt deterministically instead of drawing it at random.
 *
 * `AequiraPrivateState` holds exactly one `scoreSalt`, and `revealScore` must
 * reproduce the same `(score, salt)` pair that produced the on-chain
 * commitment. A fresh random salt per commit therefore destroys the opening
 * of every application scored earlier by the same reviewer, because
 * `assert(scoreCommitments.member(...))` no longer matches.
 *
 * Deriving from the reviewer secret fixes that without changing the contract
 * or the private state shape:
 *
 *   salt = SHA-256("aequira:ui-salt:v1" || roundId || applicationId || reviewerSecret)
 *
 * The salt stays secret because it is seeded with 256 bits of reviewerSecret.
 * It must stay secret: a score carries roughly seven bits of entropy, so an
 * observer who knew the salt could brute-force the commitment. Being
 * deterministic costs nothing here — an observer still cannot compute a
 * single candidate commitment without the reviewer secret.
 *
 * L2 direction: hold per-application salts inside private state, which
 * removes the derivation entirely at the cost of a private state migration.
 */
export const deriveScoreSalt = async (
  roundId: Uint8Array,
  applicationId: Uint8Array,
  reviewerSecret: Uint8Array,
): Promise<Uint8Array> => {
  assertBytes32('roundId', roundId);
  assertBytes32('applicationId', applicationId);
  assertBytes32('reviewerSecret', reviewerSecret);

  const domain = new TextEncoder().encode(SCORE_SALT_DOMAIN);
  const input = new Uint8Array(domain.length + BYTE_LENGTH * 3);

  input.set(domain, 0);
  input.set(roundId, domain.length);
  input.set(applicationId, domain.length + BYTE_LENGTH);
  input.set(reviewerSecret, domain.length + BYTE_LENGTH * 2);

  try {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  } finally {
    // The buffer held the reviewer secret in the clear.
    input.fill(0);
  }
};

export const deriveApplicantId = (applicantSecret: Uint8Array): Uint8Array => {
  assertBytes32('applicantSecret', applicantSecret);
  return Uint8Array.from(pureCircuits.applicantId(applicantSecret));
};

/**
 * Computes the enrollment commitment the same way the applicant's own device
 * does: locally, from attributes and a secret that never leave it. The
 * institution never sees anything but the resulting leaf, which it hands to
 * `registerApplicant` — there is no separate path that builds the same leaf
 * from an `applicantId` alone, because the generated circuit always re-derives
 * `applicantId` from `secret` itself.
 */
export const deriveApplicantLeaf = (
  incomeBand: bigint,
  gpaScaled: bigint,
  regionCode: bigint,
  applicantSecret: Uint8Array,
  applicantSalt: Uint8Array,
): Uint8Array => {
  assertBytes32('applicantSecret', applicantSecret);
  assertBytes32('applicantSalt', applicantSalt);
  assertUintRange('incomeBand', incomeBand, MAX_UINT8);
  assertUintRange('gpaScaled', gpaScaled, MAX_UINT16);
  assertUintRange('regionCode', regionCode, MAX_UINT8);

  return Uint8Array.from(
    pureCircuits.applicantLeaf(incomeBand, gpaScaled, regionCode, applicantSecret, applicantSalt),
  );
};

export const deriveApplyNullifier = (
  roundId: Uint8Array,
  applicantSecret: Uint8Array,
): Uint8Array => {
  assertBytes32('roundId', roundId);
  assertBytes32('applicantSecret', applicantSecret);
  return Uint8Array.from(pureCircuits.applyNullifier(roundId, applicantSecret));
};

export const deriveApplicationPseudonym = (
  roundId: Uint8Array,
  applicantSecret: Uint8Array,
  nonce: Uint8Array,
): Uint8Array => {
  assertBytes32('roundId', roundId);
  assertBytes32('applicantSecret', applicantSecret);
  assertBytes32('nonce', nonce);
  return Uint8Array.from(pureCircuits.applicationPseudonym(roundId, applicantSecret, nonce));
};

const APPLY_NONCE_DOMAIN = 'aequira:apply-nonce:v1';

/**
 * Derives `apply`'s commitment randomness deterministically instead of
 * drawing it at random.
 *
 * `apply` is nullifier-gated to once per round per applicant, so there is no
 * multi-application collision to avoid the way `deriveScoreSalt` avoids one.
 * The nonce still needs to be reproducible without adding a new
 * `AequiraPrivateState` field, though: a future `claim` circuit recomputes the
 * same `applicationPseudonym` from `(roundId, applicantSecret, nonce)` alone,
 * so whatever nonce `apply` used has to be derivable again later rather than
 * remembered out of band.
 *
 *   nonce = SHA-256("aequira:apply-nonce:v1" || roundId || applicantSecret)
 *
 * It stays secret for the same reason `deriveScoreSalt`'s salt does: it is
 * seeded with 256 bits of applicant secret that only this applicant holds.
 */
export const deriveApplicationNonce = async (
  roundId: Uint8Array,
  applicantSecret: Uint8Array,
): Promise<Uint8Array> => {
  assertBytes32('roundId', roundId);
  assertBytes32('applicantSecret', applicantSecret);

  const domain = new TextEncoder().encode(APPLY_NONCE_DOMAIN);
  const input = new Uint8Array(domain.length + BYTE_LENGTH * 2);

  input.set(domain, 0);
  input.set(roundId, domain.length);
  input.set(applicantSecret, domain.length + BYTE_LENGTH);

  try {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  } finally {
    // The buffer held the applicant secret in the clear.
    input.fill(0);
  }
};
