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
  createRoundMemoryStore(storage, 'preprod').saveContractAddress(ADDRESS);

  assert.deepEqual([...storage.entries.keys()], ['aequira:preprod:contract-address']);
});

test('round-trips the contract address', () => {
  const storage = createStorage();
  const store = createRoundMemoryStore(storage, 'preprod');

  assert.equal(store.read().contractAddress, null);
  store.saveContractAddress(ADDRESS);
  assert.equal(store.read().contractAddress, ADDRESS);
});

test('round-trips application identifiers without duplicates', () => {
  const store = createRoundMemoryStore(createStorage(), 'preprod');

  store.addApplicationId(APPLICATION_A);
  store.addApplicationId(APPLICATION_B);
  store.addApplicationId(APPLICATION_A);

  assert.deepEqual(store.read().applicationIdHexes, [APPLICATION_A, APPLICATION_B]);
});

test('ignores application identifiers that are not 32-byte hex', () => {
  const store = createRoundMemoryStore(createStorage(), 'preprod');

  store.addApplicationId('not-hex');
  store.addApplicationId('a1'.repeat(31));
  store.addApplicationId(`0x${APPLICATION_A}`);

  assert.deepEqual(store.read().applicationIdHexes, []);
});

test('tolerates corrupted storage instead of throwing', () => {
  const store = createRoundMemoryStore(
    createStorage({
      'aequira:preprod:application-ids': '{not json',
      'aequira:preprod:contract-address': '',
    }),
    'preprod',
  );

  assert.deepEqual(store.read(), { applicationIdHexes: [], contractAddress: null });
});

test('drops non-hex entries found inside otherwise valid stored JSON', () => {
  const store = createRoundMemoryStore(
    createStorage({
      'aequira:preprod:application-ids': JSON.stringify([APPLICATION_A, 42, 'nope', null]),
    }),
    'preprod',
  );

  assert.deepEqual(store.read().applicationIdHexes, [APPLICATION_A]);
});

test('returns empty memory when storage itself is unavailable', () => {
  const store = createRoundMemoryStore(
    {
      getItem: () => {
        throw new Error('storage disabled');
      },
      removeItem: () => {},
      setItem: () => {},
    },
    'preprod',
  );

  assert.deepEqual(store.read(), { applicationIdHexes: [], contractAddress: null });
});

test('clear removes both keys', () => {
  const storage = createStorage();
  const store = createRoundMemoryStore(storage, 'preprod');

  store.saveContractAddress(ADDRESS);
  store.addApplicationId(APPLICATION_A);
  store.clear();

  assert.equal(storage.entries.size, 0);
  assert.deepEqual(store.read(), { applicationIdHexes: [], contractAddress: null });
});

test('persists nothing beyond the public round coordinates', () => {
  const storage = createStorage();
  const store = createRoundMemoryStore(storage, 'preprod');

  store.saveContractAddress(ADDRESS);
  store.addApplicationId(APPLICATION_A);

  const persisted = JSON.stringify([...storage.entries]);

  // The API exposes no way to store these, and this asserts it stays that way.
  for (const forbidden of ['score', 'salt', 'secret', 'password']) {
    assert.ok(!persisted.includes(forbidden), `storage leaked ${forbidden}: ${persisted}`);
  }
});
