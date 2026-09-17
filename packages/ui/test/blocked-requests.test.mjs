import assert from 'node:assert/strict';
import test from 'node:test';

import {
  blockedRequestOrigins,
  recordBlockedRequest,
  toBlockedOrigin,
} from '../.test-build/blocked-requests.js';

test('reduces a blocked URI to the origin the policy refused', () => {
  assert.equal(
    toBlockedOrigin('https://midnight-preprod.blockfrost.io/api/v0?project_id=secret'),
    'https://midnight-preprod.blockfrost.io',
  );
  assert.equal(
    toBlockedOrigin('wss://midnight-preprod.blockfrost.io/api/v0/ws'),
    'wss://midnight-preprod.blockfrost.io',
  );
});

test('keeps an unparseable blocked URI rather than dropping the only clue', () => {
  assert.equal(toBlockedOrigin('inline'), 'inline');
});

test('drops the query string, so a project key never reaches an error message', () => {
  recordBlockedRequest(
    'https://rpc.midnight-preprod.blockfrost.io?project_id=nightpreprodsecret',
    'connect-src',
  );

  const origins = blockedRequestOrigins();

  assert.ok(origins.includes('https://rpc.midnight-preprod.blockfrost.io'));
  for (const origin of origins) {
    assert.doesNotMatch(origin, /project_id/);
    assert.doesNotMatch(origin, /nightpreprodsecret/);
  }
});

test('records connection directives only, so a blocked image is never read as a cause', () => {
  recordBlockedRequest('https://fonts.example/font.woff2', 'font-src');
  recordBlockedRequest('https://images.example/logo.png', 'img-src');
  recordBlockedRequest('https://scripts.example/app.js', 'script-src');

  const origins = blockedRequestOrigins();

  assert.ok(!origins.includes('https://fonts.example'));
  assert.ok(!origins.includes('https://images.example'));
  assert.ok(!origins.includes('https://scripts.example'));
});

test('ignores an empty blocked URI and does not grow without limit', () => {
  recordBlockedRequest('', 'connect-src');
  assert.ok(!blockedRequestOrigins().includes(''));

  for (let index = 0; index < 40; index += 1) {
    recordBlockedRequest(`https://host-${index}.example`, 'connect-src');
  }

  assert.ok(blockedRequestOrigins().length <= 8);
});
