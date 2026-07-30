import { PasswordValidationError, validatePassword } from '@midnight-ntwrk/midnight-js-utils';

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

const collectErrorMessages = (error: unknown): string => {
  const messages: string[] = [];
  let current = error;

  for (let depth = 0; depth < 5; depth += 1) {
    if (!(current instanceof Error)) {
      break;
    }

    messages.push(current.message);
    current = current.cause;
  }

  return messages.join(' ').toLowerCase();
};

export const toDeploymentErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.name === 'DustUnavailableError') {
    return 'tDUST is not ready in Lace yet. Open the DUST Tank, finish generation, and retry.';
  }
  if (error instanceof PasswordValidationError) {
    return passwordValidationErrorMessage(error);
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

  return 'The contract could not be deployed. No private value was displayed or written to Git.';
};
