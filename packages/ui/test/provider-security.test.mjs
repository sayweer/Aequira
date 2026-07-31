import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeLocalProofServerUrl } from '../.test-build/provider-security.js';

test('accepts credential-free loopback proof servers', () => {
  assert.equal(normalizeLocalProofServerUrl('http://127.0.0.1:6300/'), 'http://127.0.0.1:6300');
  assert.equal(normalizeLocalProofServerUrl('http://localhost:6300'), 'http://localhost:6300');
});

test('rejects remote, credential-bearing, and non-HTTP proof servers', () => {
  assert.throws(() => normalizeLocalProofServerUrl('https://prover.example.com'), /loopback/);
  assert.throws(
    () => normalizeLocalProofServerUrl('http://user:secret@localhost:6300'),
    /loopback/,
  );
  assert.throws(() => normalizeLocalProofServerUrl('ws://127.0.0.1:6300'), /loopback/);
});
