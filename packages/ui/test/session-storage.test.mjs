import assert from 'node:assert/strict';
import test from 'node:test';

import { createRoundMemoryStore } from '../.test-build/session-storage.js';

const APPLICATION_A = 'a1'.repeat(32);
const APPLICATION_B = 'b2'.repeat(32);
const ADDRESS = '0200a1b2c3d4e5f60718293a4b5c6d7e8f90';

const createStorage = (initial = {}) => {
  const entries = new Map(Object.entries(initial));

  return {
    entries,
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    removeItem: (key) => {
      entries.delete(key);
    },
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
};

test('namespaces stored keys by network', () => {
  const storage = createStorage();
  createRoundMemoryStore(() => storage, 'preprod').saveContractAddress(ADDRESS);

  assert.deepEqual([...storage.entries.keys()], ['aequira:preprod:contract-address']);
});

test('round-trips the contract address', () => {
  const storage = createStorage();
  const store = createRoundMemoryStore(() => storage, 'preprod');

  assert.equal(store.read().contractAddress, null);
  store.saveContractAddress(ADDRESS);
  assert.equal(store.read().contractAddress, ADDRESS);
});

test('tolerates corrupted storage instead of throwing', () => {
  const storage = createStorage({
    'aequira:preprod:application-ids': '{not json',
    'aequira:preprod:contract-address': '',
  });
  const store = createRoundMemoryStore(() => storage, 'preprod');

  assert.deepEqual(store.read(), { contractAddress: null });
});

test('returns empty memory when storage itself is unavailable', () => {
  const store = createRoundMemoryStore(
    () => ({
      getItem: () => {
        throw new Error('storage disabled');
      },
      removeItem: () => {},
      setItem: () => {},
    }),
    'preprod',
  );

  assert.deepEqual(store.read(), { contractAddress: null });
});

test('keeps working when merely reaching storage throws, as with blocked site data', () => {
  // Reading window.localStorage itself throws in that case, before any method runs.
  const store = createRoundMemoryStore(() => {
    throw new Error('SecurityError: storage access denied');
  }, 'preprod');

  assert.doesNotThrow(() => store.saveContractAddress(ADDRESS));
  assert.doesNotThrow(() => store.clear());
  assert.deepEqual(store.read(), { contractAddress: null });
});

test('does not throw when a write fails, as with a full quota', () => {
  const storage = {
    ...createStorage(),
    removeItem: () => {
      throw new Error('storage disabled');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  const store = createRoundMemoryStore(() => storage, 'preprod');

  assert.doesNotThrow(() => store.saveContractAddress(ADDRESS));
  assert.doesNotThrow(() => store.clear());
});

test('clear removes the address and the application IDs earlier builds stored', () => {
  const storage = createStorage({
    'aequira:preprod:application-ids': JSON.stringify([APPLICATION_A, APPLICATION_B]),
  });
  const store = createRoundMemoryStore(() => storage, 'preprod');

  store.saveContractAddress(ADDRESS);
  store.clear();

  assert.equal(storage.entries.size, 0);
  assert.deepEqual(store.read(), { contractAddress: null });
});

test('persists nothing beyond the public round coordinates', () => {
  const storage = createStorage();
  const store = createRoundMemoryStore(() => storage, 'preprod');

  store.saveContractAddress(ADDRESS);

  const persisted = JSON.stringify([...storage.entries]);

  // The API exposes no way to store these, and this asserts it stays that way.
  for (const forbidden of ['score', 'salt', 'secret', 'password']) {
    assert.ok(!persisted.includes(forbidden), `storage leaked ${forbidden}: ${persisted}`);
  }
});
