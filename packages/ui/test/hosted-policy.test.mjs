import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { LOOPBACK_HOSTS } from '../.test-build/provider-security.js';

// The hosted build's Content-Security-Policy is an allowlist, but the endpoints
// the app calls are chosen by the wallet at runtime. Every time the allowlist
// missed one, the page failed with no usable explanation: first the Preprod
// indexer and node, then the proof server under the spelling Lace reports.
// These read the deployed policy and fail here instead.
const policy = JSON.parse(readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8'));

const directive = (name) => {
  const header = policy.headers
    .flatMap((entry) => entry.headers)
    .find((entry) => entry.key === 'Content-Security-Policy');

  assert.ok(header, 'the hosted build must send a Content-Security-Policy');

  const found = header.value
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));

  assert.ok(found, `the policy must set ${name}`);

  return found.split(/\s+/).slice(1);
};

test('allows a local proof server under every spelling the app accepts', () => {
  const connect = directive('connect-src');

  for (const host of LOOPBACK_HOSTS) {
    for (const scheme of ['http', 'https']) {
      assert.ok(
        connect.includes(`${scheme}://${host}:*`),
        `connect-src must allow ${scheme}://${host}:* because normalizeLocalProofServerUrl accepts it`,
      );
    }
  }
});

test('allows the Preprod endpoints the wallet reports', () => {
  const connect = directive('connect-src');

  // Lace serves Preprod through Blockfrost; Midnight's own hosts stay valid.
  for (const source of [
    "'self'",
    'https://*.midnight.network',
    'wss://*.midnight.network',
    'https://*.blockfrost.io',
    'wss://*.blockfrost.io',
  ]) {
    assert.ok(connect.includes(source), `connect-src must allow ${source}`);
  }
});

test('keeps the WebAssembly and framing protections the app depends on', () => {
  // Midnight's ledger and onchain-runtime are WebAssembly: without this the
  // page renders blank with a CompileError and nothing else.
  assert.ok(directive('script-src').includes("'wasm-unsafe-eval'"));
  assert.deepEqual(directive('frame-ancestors'), ["'none'"]);
  assert.deepEqual(directive('object-src'), ["'none'"]);
});

test('never opens connect-src to the whole web', () => {
  const connect = directive('connect-src');

  for (const wildcard of ['*', 'https:', 'http:', 'ws:', 'wss:', 'data:']) {
    assert.ok(!connect.includes(wildcard), `connect-src must not allow ${wildcard}`);
  }
});
