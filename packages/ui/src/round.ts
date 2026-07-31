// Orchestrates a round from the browser: deploy or join, one function per
// circuit, and a read of the public ledger.
//
// The call shape mirrors packages/cli/src/commands.ts, which is the reference
// for how private state and `callTx` interact. Everything that can be asserted
// without providers lives in the pure modules this imports.

import {
  AEQUIRA_PRIVATE_STATE_ID,
  createAequiraPrivateState,
  deriveReviewerId,
  deriveScoreCommitment,
  deriveScoreNullifier,
  joinAequira,
  queryAequiraLedger,
  setAequiraPrivateState,
  type AequiraPrivateState,
  type AequiraProviders,
  type FoundAequiraContract,
} from '@aequira/sdk';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import type { FinalizedTxData } from '@midnight-ntwrk/midnight-js-types';

import { createBrowserProviderSession, type BrowserProviderSession } from './browser-providers.js';
import { withDeploymentStage } from './deployment-errors.js';
import { deployNewAequira } from './deployment.js';
import type { ProofMode } from './proof-mode.js';
import { bytesToHex, hexToBytes, toRoundView, type RoundView } from './round-format.js';
import { parseApplicationId, parseContractAddressInput, parseReviewerId } from './round-inputs.js';
import { deriveScoreSalt } from './round-salt.js';

export type RoundSession = {
  readonly address: ContractAddress;
  readonly contract: FoundAequiraContract;
  readonly proofMode: ProofMode;
  readonly providers: AequiraProviders;
  /** Immutable for the lifetime of the round, so it is read once. */
  readonly roundId: Uint8Array;
  close(): Promise<void>;
};

export type ScoreOpening = {
  readonly applicationIdHex: string;
  /** Computed locally before the transaction is built. */
  readonly commitmentHex: string;
  readonly nullifierHex: string;
};

export type CommitScoreResult = {
  readonly opening: ScoreOpening;
  readonly tx: FinalizedTxData;
};

export type ScoreInput = {
  readonly applicationIdHex: string;
  readonly score: number;
};

const readRoundId = async (
  providers: AequiraProviders,
  address: ContractAddress,
): Promise<Uint8Array> => {
  const ledger = await withDeploymentStage('ledger-query', () =>
    queryAequiraLedger(providers, address),
  );

  if (ledger === null) {
    throw new Error('The indexer has not seen that contract address yet');
  }

  return Uint8Array.from(ledger.roundId);
};

const toRoundSession = async (
  session: BrowserProviderSession,
  address: ContractAddress,
  contract: FoundAequiraContract,
): Promise<RoundSession> => ({
  address,
  close: () => session.close(),
  contract,
  proofMode: session.proofMode,
  providers: session.providers,
  roundId: await readRoundId(session.providers, address),
});

export const deployRound = async (
  connectedApi: ConnectedAPI,
  privateStatePassword: string,
): Promise<RoundSession> => {
  const deployment = await deployNewAequira(connectedApi, privateStatePassword);

  try {
    return await toRoundSession(deployment.session, deployment.address, deployment.contract);
  } catch (error) {
    await deployment.session.close();
    throw error;
  }
};

export const joinRound = async (
  connectedApi: ConnectedAPI,
  privateStatePassword: string,
  contractAddressInput: string,
): Promise<RoundSession> => {
  const address = parseContractAddressInput(contractAddressInput);
  const session = await createBrowserProviderSession(connectedApi, privateStatePassword);

  try {
    // No initialPrivateState: joining must never overwrite the encrypted secrets
    // this browser already holds for the round.
    const contract = await withDeploymentStage('contract-join', () =>
      joinAequira(session.providers, { contractAddress: address }),
    );

    return await toRoundSession(session, address, contract);
  } catch (error) {
    await session.close();
    throw error;
  }
};

const readPrivateState = async (session: RoundSession): Promise<AequiraPrivateState> => {
  const privateState = await withDeploymentStage('private-state', async () => {
    session.providers.privateStateProvider.setContractAddress(session.address);
    return session.providers.privateStateProvider.get(AEQUIRA_PRIVATE_STATE_ID);
  });

  if (privateState === null) {
    throw new Error('This browser holds no private state for that contract');
  }

  return privateState;
};

export const readLocalReviewerIdHex = async (session: RoundSession): Promise<string> => {
  const privateState = await readPrivateState(session);
  return bytesToHex(deriveReviewerId(Uint8Array.from(privateState.reviewerSecret)));
};

export const registerReviewer = async (
  session: RoundSession,
  reviewerIdHexInput: string,
): Promise<FinalizedTxData> => {
  const reviewerId = hexToBytes(parseReviewerId(reviewerIdHexInput));

  const result = await withDeploymentStage('circuit-register-reviewer', () =>
    session.contract.callTx.registerReviewer(reviewerId),
  );

  return result.public;
};

export type PhaseTransition = 'openApplications' | 'openReveal' | 'openReview';

export const advancePhase = async (
  session: RoundSession,
  transition: PhaseTransition,
): Promise<FinalizedTxData> => {
  const result = await withDeploymentStage('circuit-phase-transition', () =>
    session.contract.callTx[transition](),
  );

  return result.public;
};

/**
 * Rebuilds the opening for a score without touching the network.
 *
 * The salt is derived rather than stored, so the same score always produces the
 * same commitment for the same application. See round-salt.ts.
 */
const buildOpening = async (
  session: RoundSession,
  input: ScoreInput,
): Promise<{ readonly opening: ScoreOpening; readonly privateState: AequiraPrivateState }> => {
  const applicationIdHex = parseApplicationId(input.applicationIdHex);
  const applicationId = hexToBytes(applicationIdHex);
  const current = await readPrivateState(session);
  const reviewerSecret = Uint8Array.from(current.reviewerSecret);
  const salt = await deriveScoreSalt(session.roundId, applicationId, reviewerSecret);

  return {
    opening: {
      applicationIdHex,
      commitmentHex: bytesToHex(
        deriveScoreCommitment(
          session.roundId,
          applicationId,
          BigInt(input.score),
          reviewerSecret,
          salt,
        ),
      ),
      nullifierHex: bytesToHex(
        deriveScoreNullifier(session.roundId, applicationId, reviewerSecret),
      ),
    },
    privateState: createAequiraPrivateState(
      Uint8Array.from(current.adminSecret),
      reviewerSecret,
      BigInt(input.score),
      salt,
    ),
  };
};

/**
 * Writes the score and its derived salt into encrypted private state, so the
 * witnesses read them during proving, then submits the call.
 */
export const commitScore = async (
  session: RoundSession,
  input: ScoreInput,
): Promise<CommitScoreResult> => {
  const { opening, privateState } = await buildOpening(session, input);

  await withDeploymentStage('private-state-update', () =>
    setAequiraPrivateState(session.providers, session.address, privateState),
  );

  const result = await withDeploymentStage('circuit-commit-score', () =>
    session.contract.callTx.commitScore(hexToBytes(opening.applicationIdHex)),
  );

  return { opening, tx: result.public };
};

/**
 * Checks an opening against the on-chain commitment set locally.
 *
 * A mismatched score would fail the contract's own assertion, wasting a proof
 * and a fee. It also demonstrates the reverse of the privacy claim: this browser
 * can verify the opening without publishing the score.
 */
export const hasMatchingCommitment = async (
  session: RoundSession,
  input: ScoreInput,
): Promise<boolean> => {
  const { opening } = await buildOpening(session, input);
  const ledger = await withDeploymentStage('ledger-query', () =>
    queryAequiraLedger(session.providers, session.address),
  );

  return ledger === null
    ? false
    : ledger.scoreCommitments.member(hexToBytes(opening.commitmentHex));
};

export const revealScore = async (
  session: RoundSession,
  input: ScoreInput,
): Promise<FinalizedTxData> => {
  const { opening, privateState } = await buildOpening(session, input);

  await withDeploymentStage('private-state-update', () =>
    setAequiraPrivateState(session.providers, session.address, privateState),
  );

  const result = await withDeploymentStage('circuit-reveal-score', () =>
    session.contract.callTx.revealScore(hexToBytes(opening.applicationIdHex)),
  );

  return result.public;
};

export const readRoundState = async (
  session: RoundSession,
  knownApplicationIdHexes: readonly string[],
): Promise<RoundView | null> => {
  const ledger = await withDeploymentStage('ledger-query', () =>
    queryAequiraLedger(session.providers, session.address),
  );

  return ledger === null ? null : toRoundView(ledger, knownApplicationIdHexes);
};
