import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DeploymentStageError,
  getPrivateStatePasswordError,
  toCircuitErrorMessage,
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

test('explains each contract assertion a circuit call can fail on', () => {
  const cases = [
    ['Only the round administrator can perform this action', /not the round administrator/],
    ['Reviewer is already registered', /already registered for this round/],
    ['Reviewer is not registered', /pseudonym is not registered/],
    ['Reviewer already scored this application', /replay nullifier/],
    ['Reviewers can only be registered during setup', /while the round is in setup/],
    ['Scores can only be committed during review', /during the review phase/],
    ['Scores can only be revealed during reveal', /during the reveal phase/],
    ['Review can only open after applications', /not available from the current phase/],
    ['Score exceeds the rubric maximum', /above the rubric maximum/],
    ['Matching score commitment was not found', /does not open the commitment recorded on chain/],
  ];

  for (const [assertion, expected] of cases) {
    assert.match(
      toCircuitErrorMessage(new DeploymentStageError('circuit-commit-score', new Error(assertion))),
      expected,
      `unexpected message for ${JSON.stringify(assertion)}`,
    );
  }
});

test('reports the new circuit stages without exposing their causes', () => {
  const secret = { privateValue: 'hidden-score-93' };

  const byStage = {
    'contract-join': /could not join that contract/,
    'ledger-query': /public round state could not be read/,
    'private-state-update': /encrypted browser storage could not be read or updated/,
  };

  for (const [stage, expected] of Object.entries(byStage)) {
    const message = toCircuitErrorMessage(new DeploymentStageError(stage, secret));

    assert.match(message, expected);
    assert.doesNotMatch(message, /hidden-score-93/);
  }
});

test('does not expose unknown circuit error contents', () => {
  const message = toCircuitErrorMessage(new Error('secret-value-from-provider'));

  assert.doesNotMatch(message, /secret-value/);
  assert.match(message, /circuit call could not be completed/);
});

test('recognizes cancelled circuit calls through the connector and through text', () => {
  assert.match(
    toCircuitErrorMessage({ code: 'Rejected', type: 'DAppConnectorAPIError' }),
    /cancelled in Lace/,
  );
  assert.match(toCircuitErrorMessage(new Error('User declined the request')), /cancelled in Lace/);
});

test('keeps the deployment messages byte-identical after adding circuit messages', () => {
  const dustError = new Error('DUST is not ready');
  dustError.name = 'DustUnavailableError';

  assert.equal(
    toDeploymentErrorMessage(dustError),
    'tDUST is not ready in Lace yet. Open the DUST Tank, finish generation, and retry.',
  );
  assert.equal(
    toDeploymentErrorMessage(new Error('secret-value-from-provider')),
    'The contract could not be deployed. No private value was displayed or written to Git.',
  );
  assert.equal(
    toDeploymentErrorMessage(new DeploymentStageError('contract-deployment', new Error('opaque'))),
    'The contract deployment pipeline stopped before submission. Keep the local proof server running and retry.',
  );
});
