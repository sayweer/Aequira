// Derives the score salt deterministically, per application.
//
// Why not a fresh random salt per commit, as the CLI does: `AequiraPrivateState`
// holds exactly one `scoreSalt`, and `revealScore` must reproduce the same
// (score, salt) pair that produced the on-chain commitment. A random salt
// therefore destroys the opening of every application scored earlier — that
// reviewer can never reveal them, because
// `assert(scoreCommitments.member(...))` no longer matches.
//
// Deriving from the reviewer secret fixes that without changing the contract,
// the private state shape, or the CLI:
//
//   salt = SHA-256( "aequira:ui-salt:v1" || roundId || applicationId || reviewerSecret )
//
// The salt stays secret because it is seeded with 256 bits of reviewerSecret. It
// must stay secret: a score carries roughly seven bits of entropy, so an
// observer who knew the salt could brute-force the commitment. Being
// deterministic costs nothing here — an observer still cannot compute a single
// candidate commitment without the reviewer secret.
//
// L2 direction: hold per-application salts inside private state, which removes
// the derivation entirely at the cost of a private state migration.

const SALT_DOMAIN = 'aequira:ui-salt:v1';
const BYTE_LENGTH = 32;

const assertBytes32 = (name: string, value: Uint8Array): void => {
  if (value.byteLength !== BYTE_LENGTH) {
    throw new RangeError(`${name} must contain exactly ${BYTE_LENGTH} bytes`);
  }
};

export const deriveScoreSalt = async (
  roundId: Uint8Array,
  applicationId: Uint8Array,
  reviewerSecret: Uint8Array,
): Promise<Uint8Array> => {
  assertBytes32('roundId', roundId);
  assertBytes32('applicationId', applicationId);
  assertBytes32('reviewerSecret', reviewerSecret);

  const domain = new TextEncoder().encode(SALT_DOMAIN);
  const input = new Uint8Array(domain.length + BYTE_LENGTH * 3);

  input.set(domain, 0);
  input.set(roundId, domain.length);
  input.set(applicationId, domain.length + BYTE_LENGTH);
  input.set(reviewerSecret, domain.length + BYTE_LENGTH * 2);

  try {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  } finally {
    // The buffer held the reviewer secret in the clear.
    input.fill(0);
  }
};
