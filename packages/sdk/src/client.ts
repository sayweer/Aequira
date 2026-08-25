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

const assertBytes32 = (name: string, value: Uint8Array): void => {
  if (value.byteLength !== BYTE_LENGTH) {
    throw new RangeError(`${name} must contain exactly ${BYTE_LENGTH} bytes`);
  }
};

export const validateAequiraPrivateState = (privateState: AequiraPrivateState): void => {
  assertBytes32('adminSecret', privateState.adminSecret);
  assertBytes32('reviewerSecret', privateState.reviewerSecret);
  assertBytes32('scoreSalt', privateState.scoreSalt);

  if (privateState.score < 0n || privateState.score > 100n) {
    throw new RangeError('score must be between 0 and 100');
  }
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
};

export const deployAequira = async (
  providers: AequiraProviders,
  options: DeployAequiraOptions,
): Promise<FoundAequiraContract> => {
  assertBytes32('roundId', options.roundId);
  validateAequiraPrivateState(options.privateState);

  const deployed = await deployContract<AequiraContract>(providers, {
    compiledContract: compiledAequiraContract,
    privateStateId: AEQUIRA_PRIVATE_STATE_ID,
    initialPrivateState: options.privateState,
    args: [options.roundId, options.privateState.adminSecret],
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
