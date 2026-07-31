import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DeploymentStageError,
  getPrivateStatePasswordError,
  toDeploymentErrorMessage,
} from '../.test-build/deployment-errors.js';

test('accepts matching local storage passwords that satisfy the shared policy', () => {
  const password = 'Str0ng!LocalVault#2026';
  assert.equal(getPrivateStatePasswordError(password, password), null);
});

test('rejects mismatched and weak local storage passwords without echoing them', () => {
  assert.match(getPrivateStatePasswordError('first', 'second'), /do not match/);
  assert.match(getPrivateStatePasswordError('short', 'short'), /16 characters/);
});

test('maps missing DUST and proof server failures to actionable messages', () => {
  const dustError = new Error('DUST is not ready');
  dustError.name = 'DustUnavailableError';

  assert.match(toDeploymentErrorMessage(dustError), /tDUST is not ready/);
  assert.match(
    toDeploymentErrorMessage(new Error('outer', { cause: new Error('Failed Proof Server') })),
    /proof server could not be reached/,
  );
});

test('does not expose unknown deployment error contents', () => {
  const message = toDeploymentErrorMessage(new Error('secret-value-from-provider'));

  assert.doesNotMatch(message, /secret-value/);
  assert.match(message, /could not be deployed/);
});

test('recognizes connector errors crossing the wallet extension boundary', () => {
  const connectorError = {
    code: 'PermissionRejected',
    reason: 'private extension detail',
    type: 'DAppConnectorAPIError',
  };
  const message = toDeploymentErrorMessage(connectorError);

  assert.match(message, /did not grant the permissions/);
  assert.doesNotMatch(message, /private extension detail/);
});

test('reports a safe deployment stage when the underlying error is unknown', () => {
  const message = toDeploymentErrorMessage(
    new DeploymentStageError('wallet-context', { privateValue: 'hidden' }),
  );

  assert.match(message, /Preprod configuration, tDUST, or shielded addresses/);
  assert.doesNotMatch(message, /hidden/);
});

test('separates local proving from Lace balancing and submission failures', () => {
  assert.match(
    toDeploymentErrorMessage(new DeploymentStageError('proof-generation', new TypeError('fetch'))),
    /proof request failed before Lace balancing/,
  );
  assert.match(
    toDeploymentErrorMessage(new DeploymentStageError('wallet-balancing', { reason: 'private' })),
    /could not balance the proven transaction/,
  );
  assert.match(
    toDeploymentErrorMessage(
      new DeploymentStageError('transaction-submission', { reason: 'private' }),
    ),
    /could not submit the balanced Preprod transaction/,
  );
});
