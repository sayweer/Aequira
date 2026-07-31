import assert from 'node:assert/strict';
import test from 'node:test';

import { describeProofMode, selectProofMode } from '../.test-build/proof-mode.js';

const base = {
  hasProvingProvider: false,
  isDev: false,
  origin: 'https://aequira.example',
};

test('development always proves through the same-origin dev proxy', () => {
  assert.deepEqual(selectProofMode({ ...base, isDev: true, origin: 'http://127.0.0.1:3000' }), {
    kind: 'same-origin',
    url: 'http://127.0.0.1:3000/__aequira_local',
  });
});

test('development ignores wallet proving and configured URLs', () => {
  const mode = selectProofMode({
    ...base,
    configuredUrl: 'http://127.0.0.1:9999',
    hasProvingProvider: true,
    isDev: true,
    origin: 'http://127.0.0.1:3000',
  });

  assert.equal(mode.kind, 'same-origin');
});

test('production prefers wallet proving when the connector exposes it', () => {
  assert.deepEqual(selectProofMode({ ...base, hasProvingProvider: true }), { kind: 'wallet' });
});

test('production falls back to the default loopback prover', () => {
  assert.deepEqual(selectProofMode(base), {
    kind: 'loopback',
    url: 'http://127.0.0.1:6300',
  });
});

test('production accepts a loopback prover advertised by the wallet', () => {
  assert.deepEqual(selectProofMode({ ...base, walletProverUri: 'http://localhost:6300/' }), {
    kind: 'loopback',
    url: 'http://localhost:6300',
  });
});

test('a configured loopback URL takes precedence over wallet proving', () => {
  assert.deepEqual(
    selectProofMode({
      ...base,
      configuredUrl: 'http://127.0.0.1:6301',
      hasProvingProvider: true,
    }),
    { kind: 'loopback', url: 'http://127.0.0.1:6301' },
  );
});

test('a remote prover is refused even when explicitly configured', () => {
  // The witness would leave this machine, so this must never be reachable by
  // setting an environment variable.
  assert.throws(
    () => selectProofMode({ ...base, configuredUrl: 'https://prover.example.com' }),
    /credential-free local loopback/,
  );
});

test('a remote prover advertised by the wallet is also refused', () => {
  assert.throws(
    () => selectProofMode({ ...base, walletProverUri: 'https://prover.example.com' }),
    /credential-free local loopback/,
  );
});

test('a credential-bearing loopback prover is refused', () => {
  assert.throws(
    () => selectProofMode({ ...base, configuredUrl: 'http://user:secret@127.0.0.1:6300' }),
    /credential-free local loopback/,
  );
});

test('an empty configured URL is treated as unset', () => {
  assert.deepEqual(selectProofMode({ ...base, configuredUrl: '   ', hasProvingProvider: true }), {
    kind: 'wallet',
  });
});

test('describes each mode for display', () => {
  assert.equal(describeProofMode({ kind: 'wallet' }), 'Proving in Lace');
  assert.match(describeProofMode({ kind: 'loopback', url: 'x' }), /on this machine/);
  assert.match(describeProofMode({ kind: 'same-origin', url: 'x' }), /dev proxy/);
});
