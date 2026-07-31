import { PasswordValidationError, validatePassword } from '@midnight-ntwrk/midnight-js-utils';

export type DeploymentStage =
  | 'circuit-commit-score'
  | 'circuit-phase-transition'
  | 'circuit-register-reviewer'
  | 'circuit-reveal-score'
  | 'contract-deployment'
  | 'contract-join'
  | 'ledger-query'
  | 'private-state'
  | 'private-state-update'
  | 'proof-generation'
  | 'provider-configuration'
  | 'transaction-submission'
  | 'wallet-balancing'
  | 'wallet-context';

export class DeploymentStageError extends Error {
  constructor(
    readonly stage: DeploymentStage,
    cause: unknown,
  ) {
    super(`Deployment failed during ${stage}`, { cause });
    this.name = 'DeploymentStageError';
  }
}

export const withDeploymentStage = async <Value>(
  stage: DeploymentStage,
  operation: () => Value | Promise<Value>,
): Promise<Value> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DeploymentStageError) {
      throw error;
    }

    throw new DeploymentStageError(stage, error);
  }
};

const passwordValidationErrorMessage = (error: PasswordValidationError): string => {
  switch (error.reason) {
    case 'missing':
      return 'Enter a local storage password.';
    case 'too_short':
      return 'Use at least 16 characters for the local storage password.';
    case 'insufficient_classes':
      return 'Use at least three of: lowercase, uppercase, numbers, and symbols.';
    case 'repeated_characters':
      return 'Avoid repeating the same character more than three times.';
    case 'sequential_pattern':
      return 'Avoid predictable sequences such as 1234 or abcd.';
  }
};

export const getPrivateStatePasswordError = (
  password: string,
  confirmation: string,
): string | null => {
  if (password !== confirmation) {
    return 'The two local storage passwords do not match.';
  }

  try {
    validatePassword(password);
    return null;
  } catch (error) {
    return error instanceof PasswordValidationError
      ? passwordValidationErrorMessage(error)
      : 'Choose a stronger local storage password.';
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const collectErrorChain = (error: unknown): unknown[] => {
  const chain: unknown[] = [];
  let current = error;

  for (let depth = 0; depth < 6 && isRecord(current); depth += 1) {
    chain.push(current);
    current = current.cause;
  }

  return chain;
};

const collectErrorMessages = (error: unknown): string => {
  const messages: string[] = [];

  for (const current of collectErrorChain(error)) {
    if (isRecord(current) && typeof current.message === 'string') {
      messages.push(current.message);
    }
  }

  return messages.join(' ').toLowerCase();
};

const findConnectorErrorCode = (error: unknown): string | null => {
  for (const current of collectErrorChain(error)) {
    if (
      isRecord(current) &&
      current.type === 'DAppConnectorAPIError' &&
      typeof current.code === 'string'
    ) {
      return current.code;
    }
  }

  return null;
};

const findDeploymentStage = (error: unknown): DeploymentStage | null => {
  for (const current of collectErrorChain(error)) {
    if (current instanceof DeploymentStageError) {
      return current.stage;
    }
  }

  return null;
};

export const toDeploymentErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.name === 'DustUnavailableError') {
    return 'tDUST is not ready in Lace yet. Open the DUST Tank, finish generation, and retry.';
  }
  if (error instanceof PasswordValidationError) {
    return passwordValidationErrorMessage(error);
  }

  const connectorErrorCode = findConnectorErrorCode(error);

  if (connectorErrorCode === 'PermissionRejected') {
    return 'Lace did not grant the permissions needed for deployment. Reconnect and approve the requested wallet permissions.';
  }
  if (connectorErrorCode === 'Rejected') {
    return 'The deployment request was cancelled in Lace. No contract was submitted.';
  }
  if (connectorErrorCode === 'Disconnected') {
    return 'The Lace session ended before deployment. Reconnect the wallet and retry.';
  }
  if (connectorErrorCode === 'InvalidRequest') {
    return 'Lace rejected a deployment request it could not process. Confirm Lace is current, reconnect, and retry.';
  }
  if (connectorErrorCode === 'InternalError') {
    return 'Lace could not process the deployment. Confirm that it is unlocked, synced, and has usable tDUST.';
  }

  const message = collectErrorMessages(error);
  const stage = findDeploymentStage(error);

  if (message.includes('reject') || message.includes('declin') || message.includes('cancel')) {
    return 'The deployment was cancelled in Lace. No contract was submitted.';
  }
  if (message.includes('outside midnight preprod')) {
    return 'Lace returned provider settings for another network. Select Midnight Preprod and retry.';
  }
  if (stage === 'proof-generation') {
    return 'The local proof request failed before Lace balancing. AEQUIRA kept the private witness on this machine; confirm the proof server is running and retry.';
  }
  if (stage === 'wallet-balancing') {
    return 'Lace could not balance the proven transaction. Confirm that the wallet is synced and has usable tDUST.';
  }
  if (stage === 'transaction-submission') {
    return 'Lace could not submit the balanced Preprod transaction. Keep the wallet unlocked and retry.';
  }
  if (
    message.includes('proof server') ||
    message.includes('prover') ||
    message.includes('failed to fetch')
  ) {
    return 'The local proof server could not be reached. Start it and retry the deployment.';
  }
  if (message.includes('dust') || message.includes('insufficient') || message.includes('balance')) {
    return 'Lace could not fund the transaction with tDUST. Confirm that the DUST Tank is ready.';
  }
  if (message.includes('submit') || message.includes('transaction')) {
    return 'The Preprod transaction could not be submitted. Confirm Lace is synced and retry.';
  }

  if (stage === 'wallet-context') {
    return 'AEQUIRA could not read Lace Preprod configuration, tDUST, or shielded addresses. Unlock and sync Lace, then reconnect.';
  }
  if (stage === 'private-state') {
    return 'The encrypted browser storage could not be prepared. Keep this tab open, confirm browser storage is enabled, and retry.';
  }
  if (stage === 'provider-configuration') {
    return 'The Midnight browser providers could not be prepared. Refresh the page, reconnect Lace, and retry.';
  }
  if (stage === 'contract-deployment') {
    return 'The contract deployment pipeline stopped before submission. Keep the local proof server running and retry.';
  }

  return 'The contract could not be deployed. No private value was displayed or written to Git.';
};

/**
 * Assertion texts raised by the contract itself, in precedence order.
 *
 * These come from packages/contract/src/aequira.compact. They describe public
 * round state only — never a score, a salt, or a secret — so surfacing them is
 * both safe and the single most useful thing a failed call can say.
 */
const CONTRACT_ASSERTION_MESSAGES: readonly (readonly [string, string])[] = [
  [
    'only the round administrator',
    'This browser is not the round administrator. Only the wallet that deployed the round can advance phases or register reviewers.',
  ],
  [
    'reviewer is already registered',
    'That reviewer pseudonym is already registered for this round.',
  ],
  [
    'reviewer is not registered',
    'This browser’s reviewer pseudonym is not registered for this round. Ask the organizer to register it during setup.',
  ],
  [
    'reviewer already scored this application',
    'This reviewer already committed a score for that application. The replay nullifier prevents a second one.',
  ],
  [
    'reviewers can only be registered during setup',
    'Reviewers can only be registered while the round is in setup.',
  ],
  [
    'scores can only be committed during review',
    'Scores can only be committed during the review phase. Refresh the round state and check the current phase.',
  ],
  [
    'scores can only be revealed during reveal',
    'Scores can only be revealed during the reveal phase. Refresh the round state and check the current phase.',
  ],
  [
    'can only open after',
    'That phase transition is not available from the current phase. Refresh the round state and retry.',
  ],
  ['score exceeds the rubric maximum', 'The committed score is above the rubric maximum of 100.'],
  [
    'matching score commitment was not found',
    'That score does not open the commitment recorded on chain. Enter the exact score committed during review.',
  ],
];

export const toCircuitErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.name === 'DustUnavailableError') {
    return 'tDUST is not ready in Lace yet. Open the DUST Tank, finish generation, and retry.';
  }

  const connectorErrorCode = findConnectorErrorCode(error);

  if (connectorErrorCode === 'PermissionRejected') {
    return 'Lace did not grant the permissions needed for this call. Reconnect and approve the requested wallet permissions.';
  }
  if (connectorErrorCode === 'Rejected') {
    return 'The request was cancelled in Lace. No transaction was submitted.';
  }
  if (connectorErrorCode === 'Disconnected') {
    return 'The Lace session ended before the call completed. Reconnect the wallet and retry.';
  }
  if (connectorErrorCode === 'InvalidRequest') {
    return 'Lace rejected a request it could not process. Confirm Lace is current, reconnect, and retry.';
  }
  if (connectorErrorCode === 'InternalError') {
    return 'Lace could not process the call. Confirm that it is unlocked, synced, and has usable tDUST.';
  }

  const message = collectErrorMessages(error);

  for (const [needle, explanation] of CONTRACT_ASSERTION_MESSAGES) {
    if (message.includes(needle)) {
      return explanation;
    }
  }

  const stage = findDeploymentStage(error);

  if (message.includes('reject') || message.includes('declin') || message.includes('cancel')) {
    return 'The request was cancelled in Lace. No transaction was submitted.';
  }
  if (stage === 'proof-generation') {
    return 'The proof request failed before Lace balancing. AEQUIRA kept the private witness on this machine; confirm the prover is available and retry.';
  }
  if (stage === 'wallet-balancing') {
    return 'Lace could not balance the proven transaction. Confirm that the wallet is synced and has usable tDUST.';
  }
  if (stage === 'transaction-submission') {
    return 'Lace could not submit the balanced Preprod transaction. Keep the wallet unlocked and retry.';
  }
  if (
    message.includes('proof server') ||
    message.includes('prover') ||
    message.includes('failed to fetch')
  ) {
    return 'The prover could not be reached. Confirm the proof server is running and retry.';
  }
  if (message.includes('dust') || message.includes('insufficient') || message.includes('balance')) {
    return 'Lace could not fund the transaction with tDUST. Confirm that the DUST Tank is ready.';
  }
  if (stage === 'private-state' || stage === 'private-state-update') {
    return 'The encrypted browser storage could not be read or updated. Confirm browser storage is enabled and that this browser joined the round.';
  }
  if (stage === 'contract-join') {
    return 'This browser could not join that contract. It may hold no reviewer secret for that address, or the address may not be an AEQUIRA round.';
  }
  if (stage === 'ledger-query') {
    return 'The public round state could not be read from the indexer. It may still be catching up; this retries automatically.';
  }

  return 'The circuit call could not be completed. No private value was displayed.';
};
