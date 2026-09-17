// Orchestrates a round from the browser: deploy or join, one function per
// circuit, and a read of the public ledger.
//
// The call shape mirrors packages/cli/src/commands.ts, which is the reference
// for how private state and `callTx` interact. Everything that can be asserted
// without providers lives in the pure modules this imports.

import {
  AEQUIRA_PRIVATE_STATE_ID,
  EnrollmentReceiptError,
  createAequiraPrivateState,
  deriveAdminId,
  deriveApplicantId,
  deriveApplicantLeaf,
  deriveApplicationNonce,
  deriveApplicationPseudonym,
  deriveApplyNullifier,
  deriveReviewerId,
  deriveScoreCommitment,
  deriveScoreNullifier,
  deriveScoreSalt,
  hasImportedEnrollment,
  issueEnrollmentReceipt,
  joinAequira,
  openEnrollmentReceipt,
  queryAequiraLedger,
  readRoundId,
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
import { createRandomPrivateState, deployNewAequira } from './deployment.js';
import type { LastScore } from './privacy-view.js';
import type { ProofMode } from './proof-mode.js';
import { revealRejection } from './round-actions.js';
import {
  bytesToHex,
  hexToBytes,
  toRoundView,
  type LocalIdentity,
  type RoundView,
} from './round-format.js';
import {
  InputError,
  parseApplicantAttributes,
  parseApplicantId,
  parseApplicationId,
  parseContractAddressInput,
  parseReviewerId,
  type EligibilityThresholds,
} from './round-inputs.js';

export type RoundSession = {
  readonly address: ContractAddress;
  readonly contract: FoundAequiraContract;
  readonly proofMode: ProofMode;
  readonly providers: AequiraProviders;
  /** Immutable for the lifetime of the round, so it is read once. */
  readonly roundId: Uint8Array;
  close(): Promise<void>;
};

export type ScoreInput = {
  readonly applicationIdHex: string;
  readonly score: number;
};

const toRoundSession = (
  session: BrowserProviderSession,
  address: ContractAddress,
  contract: FoundAequiraContract,
  roundId: Uint8Array,
): RoundSession => ({
  address,
  close: () => session.close(),
  contract,
  proofMode: session.proofMode,
  providers: session.providers,
  roundId,
});

/**
 * The deployment already knows its round ID. Reading it back from the indexer
 * right after deploying races the indexer, and losing that race used to report
 * a failed deployment for a contract that exists, and forget its address.
 */
export const deployRound = async (
  connectedApi: ConnectedAPI,
  privateStatePassword: string,
  thresholds: EligibilityThresholds,
): Promise<RoundSession> => {
  const deployment = await deployNewAequira(connectedApi, privateStatePassword, thresholds);

  return toRoundSession(
    deployment.session,
    deployment.address,
    deployment.contract,
    deployment.roundId,
  );
};

export const joinRound = async (
  connectedApi: ConnectedAPI,
  privateStatePassword: string,
  contractAddressInput: string,
): Promise<RoundSession> => {
  const address = parseContractAddressInput(contractAddressInput);
  const session = await createBrowserProviderSession(connectedApi, privateStatePassword);

  try {
    const existing = await withDeploymentStage('private-state', async () => {
      session.providers.privateStateProvider.setContractAddress(address);
      return session.providers.privateStateProvider.get(AEQUIRA_PRIVATE_STATE_ID);
    });
    // A browser that holds secrets for this round joins with them untouched. A
    // browser new to the round gets fresh ones; without them the contract library
    // refuses to join at all.
    const contract = await withDeploymentStage('contract-join', () =>
      joinAequira(
        session.providers,
        existing === null
          ? { contractAddress: address, initialPrivateState: createRandomPrivateState() }
          : { contractAddress: address },
      ),
    );
    const roundId = await withDeploymentStage('ledger-query', () =>
      readRoundId(session.providers, address),
    );

    return toRoundSession(session, address, contract, roundId);
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

/**
 * Derives everything the page needs to place this browser in the round, from
 * its private state, without letting a secret out: every value is a one-way
 * hash or commitment, and the application pseudonym is shown only once `apply`
 * has published it.
 */
export const readLocalIdentity = async (session: RoundSession): Promise<LocalIdentity> => {
  const privateState = await readPrivateState(session);
  const applicantSecret = Uint8Array.from(privateState.applicantSecret);
  const nonce = await deriveApplicationNonce(session.roundId, applicantSecret);

  try {
    return {
      adminIdHex: bytesToHex(deriveAdminId(session.roundId, privateState.adminSecret)),
      applicantIdHex: bytesToHex(deriveApplicantId(applicantSecret)),
      applicationIdHex: bytesToHex(
        deriveApplicationPseudonym(session.roundId, applicantSecret, nonce),
      ),
      applyNullifierHex: bytesToHex(deriveApplyNullifier(session.roundId, applicantSecret)),
      enrollmentLeafHex: hasImportedEnrollment(privateState)
        ? bytesToHex(
            deriveApplicantLeaf(
              privateState.applicantIncomeBand,
              privateState.applicantGpaScaled,
              privateState.applicantRegionCode,
              applicantSecret,
              privateState.applicantSalt,
            ),
          )
        : null,
      reviewerIdHex: bytesToHex(deriveReviewerId(privateState.reviewerSecret)),
    };
  } finally {
    applicantSecret.fill(0);
    nonce.fill(0);
  }
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

/**
 * The institution's side of enrollment. It verified the attributes out of
 * band, draws a fresh salt, and registers the leaf built from the applicant's
 * public ID. The returned receipt is how the applicant learns the exact values
 * `apply` must reopen; it is private, held only in memory, and never stored.
 */
export const registerApplicant = async (
  session: RoundSession,
  applicantIdInput: string,
  incomeBandInput: string,
  gpaScaledInput: string,
  regionCodeInput: string,
): Promise<string> => {
  const applicantId = hexToBytes(parseApplicantId(applicantIdInput));
  const attributes = parseApplicantAttributes(incomeBandInput, gpaScaledInput, regionCodeInput);
  const salt = crypto.getRandomValues(new Uint8Array(32));

  try {
    const { enrollmentLeaf, receipt } = issueEnrollmentReceipt({
      roundId: session.roundId,
      applicantId,
      ...attributes,
      salt,
    });

    await withDeploymentStage('circuit-register-applicant', () =>
      session.contract.callTx.registerApplicant(enrollmentLeaf),
    );

    return receipt;
  } finally {
    salt.fill(0);
  }
};

/**
 * The applicant's side: checks the receipt against this round and this
 * browser's own applicant secret, then keeps its attributes and salt in
 * encrypted private state for `apply`.
 */
export const importEnrollmentReceipt = async (
  session: RoundSession,
  receiptText: string,
): Promise<void> => {
  const current = await readPrivateState(session);
  const applicantSecret = Uint8Array.from(current.applicantSecret);
  let opened: ReturnType<typeof openEnrollmentReceipt>;

  try {
    opened = openEnrollmentReceipt(receiptText, { roundId: session.roundId, applicantSecret });
  } catch (error) {
    // Receipt errors are fixed, input-free messages, safe to show verbatim.
    throw error instanceof EnrollmentReceiptError ? new InputError(error.message) : error;
  }

  await withDeploymentStage('private-state-update', () =>
    setAequiraPrivateState(
      session.providers,
      session.address,
      createAequiraPrivateState({
        ...current,
        applicantSecret,
        applicantIncomeBand: opened.incomeBand,
        applicantGpaScaled: opened.gpaScaled,
        applicantRegionCode: opened.regionCode,
        applicantSalt: opened.salt,
      }),
    ),
  );
};

/**
 * Submits this browser's own application and returns its public pseudonym.
 *
 * The commitment randomness is derived from `(roundId, applicantSecret)`
 * rather than drawn at random, matching the CLI's `deriveApplicationNonce` —
 * see that function in `@aequira/sdk` for why.
 */
export const applyToRound = async (session: RoundSession): Promise<string> => {
  const current = await readPrivateState(session);

  if (!hasImportedEnrollment(current)) {
    throw new InputError('Import the enrollment receipt from the institution first.');
  }

  const applicantSecret = Uint8Array.from(current.applicantSecret);
  const nonce = await deriveApplicationNonce(session.roundId, applicantSecret);

  try {
    await withDeploymentStage('circuit-apply', () => session.contract.callTx.apply(nonce));
    return bytesToHex(deriveApplicationPseudonym(session.roundId, applicantSecret, nonce));
  } finally {
    applicantSecret.fill(0);
    nonce.fill(0);
  }
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

type Opening = Omit<LastScore, 'stage'>;

/**
 * Rebuilds the opening for a score without touching the network.
 *
 * The salt is derived rather than stored, so the same score always produces the
 * same commitment for the same application. See `deriveScoreSalt` in
 * `@aequira/sdk`.
 */
const buildOpening = async (
  session: RoundSession,
  input: ScoreInput,
): Promise<{ readonly opening: Opening; readonly privateState: AequiraPrivateState }> => {
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
      score: input.score,
    },
    privateState: createAequiraPrivateState({
      ...current,
      reviewerSecret,
      score: BigInt(input.score),
      scoreSalt: salt,
    }),
  };
};

const readLedger = async (session: RoundSession) => {
  const ledger = await withDeploymentStage('ledger-query', () =>
    queryAequiraLedger(session.providers, session.address),
  );

  if (ledger === null) {
    throw new InputError('The public ledger is not available yet. Try again in a moment.');
  }

  return ledger;
};

/**
 * Writes the score and its derived salt into encrypted private state, so the
 * witnesses read them during proving, then submits the call.
 *
 * Refused up front for an ID that is not a submitted application, or one this
 * reviewer already scored: the nullifier would make either mistake permanent,
 * and a commitment to anything but a real application can never be revealed.
 */
export const commitScore = async (session: RoundSession, input: ScoreInput): Promise<Opening> => {
  const { opening, privateState } = await buildOpening(session, input);
  const ledger = await readLedger(session);

  if (!ledger.applications.member(hexToBytes(opening.applicationIdHex))) {
    throw new InputError('That application ID is not a submitted application in this round.');
  }
  if (ledger.scoreNullifiers.member(hexToBytes(opening.nullifierHex))) {
    throw new InputError('You already committed a score for that application.');
  }

  await withDeploymentStage('private-state-update', () =>
    setAequiraPrivateState(session.providers, session.address, privateState),
  );
  await withDeploymentStage('circuit-commit-score', () =>
    session.contract.callTx.commitScore(hexToBytes(opening.applicationIdHex)),
  );

  return opening;
};

/**
 * Opens a sealed score. Checked against the on-chain commitment set locally
 * first: a mismatched score would fail the contract's own assertion, wasting a
 * proof and a fee. It also demonstrates the reverse of the privacy claim — this
 * browser can verify the opening without publishing the score.
 */
export const revealScore = async (session: RoundSession, input: ScoreInput): Promise<Opening> => {
  const { opening, privateState } = await buildOpening(session, input);
  const ledger = await readLedger(session);

  const rejection = revealRejection({
    hasSealedScore: ledger.scoreNullifiers.member(hexToBytes(opening.nullifierHex)),
    scoreOpensCommitment: ledger.scoreCommitments.member(hexToBytes(opening.commitmentHex)),
  });

  if (rejection !== null) {
    throw new InputError(rejection);
  }

  await withDeploymentStage('private-state-update', () =>
    setAequiraPrivateState(session.providers, session.address, privateState),
  );
  await withDeploymentStage('circuit-reveal-score', () =>
    session.contract.callTx.revealScore(hexToBytes(opening.applicationIdHex)),
  );

  return opening;
};

export const readRoundState = async (
  session: RoundSession,
  identity: LocalIdentity | null,
): Promise<RoundView | null> => {
  const ledger = await withDeploymentStage('ledger-query', () =>
    queryAequiraLedger(session.providers, session.address),
  );

  return ledger === null ? null : toRoundView(ledger, identity);
};
