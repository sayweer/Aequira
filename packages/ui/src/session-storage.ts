// Persists only the public address of a round so a page reload does not orphan
// a deployed contract.
//
// What may be stored here is deliberately narrow: the contract address, which
// the chain already discloses. Scores, salts, secrets, receipts and the local
// storage password never reach this module — those live in the
// password-encrypted private state provider, or nowhere at all.
//
// Storage is injected rather than read from `window` so this module compiles in
// the test build. It is injected as a getter because merely touching
// `window.localStorage` throws when site data is blocked, and a page that cannot
// remember a round must still work.

export type StorageLike = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

export type RoundMemory = {
  readonly contractAddress: string | null;
};

export type RoundMemoryStore = {
  clear(): void;
  read(): RoundMemory;
  saveContractAddress(contractAddress: string): void;
};

const EMPTY: RoundMemory = { contractAddress: null };

export const createRoundMemoryStore = (
  getStorage: () => StorageLike,
  network: string,
): RoundMemoryStore => {
  const addressKey = `aequira:${network}:contract-address`;
  // Earlier builds remembered application IDs per network, which leaked them
  // from one round into the next. The ledger lists them now; this key is only
  // ever removed.
  const legacyApplicationsKey = `aequira:${network}:application-ids`;

  // Every access is best-effort: storage can be unavailable entirely (a private
  // window, blocked site data) or full, and remembering is a convenience.
  const withStorage = <Value>(use: (storage: StorageLike) => Value, fallback: Value): Value => {
    try {
      return use(getStorage());
    } catch {
      return fallback;
    }
  };

  return {
    clear: (): void => {
      withStorage((storage) => {
        storage.removeItem(addressKey);
        storage.removeItem(legacyApplicationsKey);
      }, undefined);
    },

    read: (): RoundMemory =>
      withStorage((storage) => {
        const contractAddress = storage.getItem(addressKey);
        return {
          contractAddress:
            contractAddress !== null && contractAddress.length > 0 ? contractAddress : null,
        };
      }, EMPTY),

    saveContractAddress: (contractAddress: string): void => {
      withStorage((storage) => storage.setItem(addressKey, contractAddress), undefined);
    },
  };
};
