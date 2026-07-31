// Persists only the public coordinates of a round so a page reload does not
// orphan a deployed contract.
//
// What may be stored here is deliberately narrow: the contract address and the
// application identifiers, both of which the contract already discloses. Scores,
// salts, secrets, and the local storage password never reach this module — those
// live in the password-encrypted private state provider.
//
// Storage is injected rather than read from `window` so this module compiles in
// the test build.

const HEX_32_BYTES = /^[0-9a-f]{64}$/;

export type StorageLike = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

export type RoundMemory = {
  readonly applicationIdHexes: readonly string[];
  readonly contractAddress: string | null;
};

export type RoundMemoryStore = {
  addApplicationId(applicationIdHex: string): void;
  clear(): void;
  read(): RoundMemory;
  saveContractAddress(contractAddress: string): void;
};

const EMPTY: RoundMemory = { applicationIdHexes: [], contractAddress: null };

const readJsonArray = (raw: string | null): string[] => {
  if (raw === null) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (value): value is string => typeof value === 'string' && HEX_32_BYTES.test(value),
        )
      : [];
  } catch {
    // Corrupted or hand-edited storage must never break the page.
    return [];
  }
};

export const createRoundMemoryStore = (storage: StorageLike, network: string): RoundMemoryStore => {
  const addressKey = `aequira:${network}:contract-address`;
  const applicationsKey = `aequira:${network}:application-ids`;

  const read = (): RoundMemory => {
    try {
      const contractAddress = storage.getItem(addressKey);

      return {
        applicationIdHexes: readJsonArray(storage.getItem(applicationsKey)),
        contractAddress:
          contractAddress !== null && contractAddress.length > 0 ? contractAddress : null,
      };
    } catch {
      // Storage can be unavailable entirely, for example in a private window.
      return EMPTY;
    }
  };

  return {
    addApplicationId: (applicationIdHex: string): void => {
      if (!HEX_32_BYTES.test(applicationIdHex)) {
        return;
      }

      const existing = read().applicationIdHexes;

      if (existing.includes(applicationIdHex)) {
        return;
      }

      storage.setItem(applicationsKey, JSON.stringify([...existing, applicationIdHex]));
    },

    clear: (): void => {
      storage.removeItem(addressKey);
      storage.removeItem(applicationsKey);
    },

    read,

    saveContractAddress: (contractAddress: string): void => {
      storage.setItem(addressKey, contractAddress);
    },
  };
};
