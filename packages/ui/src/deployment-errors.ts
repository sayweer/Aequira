import { PasswordValidationError, validatePassword } from '@midnight-ntwrk/midnight-js-utils';

export type DeploymentStage =
  | 'contract-deployment'
  | 'private-state'
  | 'provider-configuration'
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

  if (message.includes('reject') || message.includes('declin') || message.includes('cancel')) {
    return 'The deployment was cancelled in Lace. No contract was submitted.';
  }
  if (message.includes('outside midnight preprod')) {
    return 'Lace returned provider settings for another network. Select Midnight Preprod and retry.';
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

  const stage = findDeploymentStage(error);

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
