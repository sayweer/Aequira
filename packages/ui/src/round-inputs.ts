// Pure input validation for round actions. Runs before any provider is touched,
// so a malformed value never reaches a circuit call or a proof request.
//
// Error messages deliberately never echo the supplied value: the same inputs
// that flow through here also carry reviewer scores.

const HEX_32_BYTES = /^[0-9a-f]{64}$/;
const DIGITS = /^[0-9]{1,3}$/;

/**
 * A rejection the user can act on. Its message is safe to display verbatim,
 * which is why it is distinguishable from an error that has to be mapped.
 */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

export const MAX_SCORE = 100;

const MIN_CONTRACT_ADDRESS_LENGTH = 16;

const normalizeHexInput = (value: string): string => {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
};

const parseHex32 = (value: string, article: string, label: string): string => {
  const normalized = normalizeHexInput(value);

  if (normalized.length === 0) {
    throw new InputError(`Enter ${article} ${label}.`);
  }
  if (!HEX_32_BYTES.test(normalized)) {
    throw new InputError(
      `${article.charAt(0).toUpperCase()}${article.slice(1)} ${label} must be exactly 64 hexadecimal characters.`,
    );
  }

  return normalized;
};

/**
 * Normalizes a public application identifier to lowercase, unprefixed hex.
 * The 32-byte length is enforced here because the generated ledger accessors
 * runtime-check it and would otherwise throw from deep inside the runtime.
 */
export const parseApplicationId = (value: string): string =>
  parseHex32(value, 'an', 'application ID');

export const parseReviewerId = (value: string): string => parseHex32(value, 'a', 'reviewer ID');

export const parseScore = (value: string): number => {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new InputError('Enter a score.');
  }
  if (!DIGITS.test(trimmed)) {
    throw new InputError(`A score must be a whole number between 0 and ${MAX_SCORE}.`);
  }

  const score = Number(trimmed);

  if (score > MAX_SCORE) {
    throw new InputError(`A score must be a whole number between 0 and ${MAX_SCORE}.`);
  }

  return score;
};

export const parseContractAddressInput = (value: string): string => {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new InputError('Enter a contract address.');
  }
  if (trimmed.length < MIN_CONTRACT_ADDRESS_LENGTH || /\s/.test(trimmed)) {
    throw new InputError('That does not look like a Midnight contract address.');
  }

  return trimmed;
};
