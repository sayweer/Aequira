import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isInitialApi,
  isPreprodUnshieldedAddress,
  listInjectedWallets,
  shortenAddress,
  toWalletErrorMessage,
} from '../.test-build/wallet.js';

const createWallet = (overrides = {}) => ({
  apiVersion: '4.0.1',
  connect: async () => {
    throw new Error('not used');
  },
  icon: 'data:image/svg+xml;base64,',
  name: 'Lace',
  rdns: 'io.lace',
  ...overrides,
});

test('accepts a complete DApp Connector Initial API', () => {
  assert.equal(isInitialApi(createWallet()), true);
  assert.equal(isInitialApi({ name: 'Lace' }), false);
});

test('discovers valid injected wallets and ignores unrelated globals', () => {
  const result = listInjectedWallets({
    second: createWallet({ name: 'Second wallet', rdns: 'io.second' }),
    invalid: { name: 'not a wallet' },
    first: createWallet({ name: 'First wallet', rdns: 'io.first' }),
  });

  assert.deepEqual(
    result.map(({ id }) => id),
    ['first', 'second'],
  );
});

test('recognizes only the Preprod unshielded address prefix', () => {
  assert.equal(isPreprodUnshieldedAddress('mn_addr_preprod1abc'), true);
  assert.equal(isPreprodUnshieldedAddress('mn_shield-addr_preprod1abc'), false);
  assert.equal(isPreprodUnshieldedAddress('mn_addr1abc'), false);
});

test('shortens public addresses without changing short values', () => {
  assert.equal(shortenAddress('mn_addr_preprod1short'), 'mn_addr_preprod1short');
  assert.equal(
    shortenAddress('mn_addr_preprod1abcdefghijklmnopqrstuvwxyz0123456789'),
    'mn_addr_preprod1ab…0123456789',
  );
});

test('maps rejected connections to a recoverable message', () => {
  assert.match(toWalletErrorMessage(new Error('User rejected request')), /cancelled in Lace/);
  assert.match(toWalletErrorMessage(new Error('unknown')), /could not connect/);
});
