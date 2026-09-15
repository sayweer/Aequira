// The text an institution hands an applicant after enrolling them: the
// attributes it verified, the salt it drew, and the leaf it registered.
//
// It is private. Anyone holding a receipt and the applicant ID can confirm the
// applicant's attributes, so it travels out of band and is never logged. Every
// error here is a fixed message that never echoes the input.

const PREFIX = 'aequira-enrollment';
const VERSION = 'v1';
const PART_COUNT = 9;

const HEX_32_BYTES = /^[0-9a-f]{64}$/;
const CANONICAL_UINT = /^(0|[1-9][0-9]*)$/;
const ZERO_HEX_32_BYTES = '0'.repeat(64);

export type EnrollmentReceipt = {
  readonly roundIdHex: string;
  readonly applicantIdHex: string;
  readonly incomeBand: bigint;
  readonly gpaScaled: bigint;
  readonly regionCode: bigint;
  readonly saltHex: string;
  readonly enrollmentLeafHex: string;
};

export class EnrollmentReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnrollmentReceiptError';
  }
}

const parseHex = (value: string, label: string): string => {
  const normalized = value.toLowerCase();

  if (!HEX_32_BYTES.test(normalized)) {
    throw new EnrollmentReceiptError(`The receipt's ${label} is not 64 hexadecimal characters.`);
  }

  return normalized;
};

const parseUint = (value: string, label: string, maximum: bigint): bigint => {
  if (!CANONICAL_UINT.test(value) || BigInt(value) > maximum) {
    throw new EnrollmentReceiptError(
      `The receipt's ${label} is not a whole number from 0 to ${maximum}.`,
    );
  }

  return BigInt(value);
};

export const formatEnrollmentReceipt = (receipt: EnrollmentReceipt): string =>
  [
    PREFIX,
    VERSION,
    receipt.roundIdHex,
    receipt.applicantIdHex,
    receipt.incomeBand.toString(),
    receipt.gpaScaled.toString(),
    receipt.regionCode.toString(),
    receipt.saltHex,
    receipt.enrollmentLeafHex,
  ].join(':');

/** Accepts a receipt wrapped across lines or padded with spaces by a clipboard. */
export const parseEnrollmentReceipt = (text: string): EnrollmentReceipt => {
  const parts = text.replace(/\s+/g, '').split(':');

  if (parts[0] !== PREFIX) {
    throw new EnrollmentReceiptError('This is not an AEQUIRA enrollment receipt.');
  }
  if (parts[1] !== VERSION) {
    throw new EnrollmentReceiptError('This enrollment receipt uses an unsupported version.');
  }
  if (parts.length !== PART_COUNT) {
    throw new EnrollmentReceiptError('This enrollment receipt is incomplete or has extra fields.');
  }

  const [, , roundId, applicantId, incomeBand, gpaScaled, regionCode, salt, leaf] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const saltHex = parseHex(salt, 'salt');

  if (saltHex === ZERO_HEX_32_BYTES) {
    throw new EnrollmentReceiptError("The receipt's salt is empty.");
  }

  return {
    roundIdHex: parseHex(roundId, 'round ID'),
    applicantIdHex: parseHex(applicantId, 'applicant ID'),
    incomeBand: parseUint(incomeBand, 'income band', 255n),
    gpaScaled: parseUint(gpaScaled, 'grade average', 65535n),
    regionCode: parseUint(regionCode, 'region code', 255n),
    saltHex,
    enrollmentLeafHex: parseHex(leaf, 'enrollment leaf'),
  };
};
