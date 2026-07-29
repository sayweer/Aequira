# Verified Compact Syntax

> Verified on 2026-07-30 with Compact devtools `0.5.1`, compiler `0.31.1`,
> and language version `0.23.0`.

## Evidence

- Official source: `midnightntwrk/example-bboard`
- Verified commit: `c56dfa27d40b2dcdbe24c511d2d313d762e16a1c`
- Official contract CI passed locally: compile, typecheck, lint, build, and 9 tests
- A separate scratch contract compiled successfully with `Set`, `Map`, nested
  `Map<..., Set<...>>`, and `MerkleTree`
- Generated compiler output was written only to temporary or ignored directories

Current official references:

- [Compatibility matrix](https://docs.midnight.network/relnotes/support-matrix)
- [Compact tool usage](https://docs.midnight.network/compact/compilation-and-tooling/dev-tool-usage)
- [Writing a contract](https://docs.midnight.network/compact/reference/writing)
- [Ledger data types](https://docs.midnight.network/compact/reference/ledger-adt)
- [Explicit disclosure](https://docs.midnight.network/compact/reference/explicit-disclosure)

## Module header

```compact
pragma language_version 0.23;

import CompactStandardLibrary;
```

The plan's generic `>= 0.19` pragma must not be used. The current compiler and
official example use an exact language version.

The plan's top-level declaration `const MAX_SCORE: Uint<16> = 100;` was rejected
by compiler `0.31.1` as an invalid program element. The L1 contract currently
uses the typed numeric literal directly in its assertion instead of pretending
that the older constant syntax still works.

## Public ledger declarations

Ledger fields use `export ledger`, not an unexported `ledger` declaration:

```compact
export ledger phase: Phase;
export ledger sequence: Counter;
export ledger seen: Set<Bytes<32>>;
export ledger scores: Map<Bytes<32>, Uint<64>>;
export ledger commitments: Map<Bytes<32>, Set<Bytes<32>>>;
export ledger applicants: MerkleTree<10, Bytes<32>>;
```

The scratch probe compiled these operations:

```compact
seen.insert(disclose(id));
scores.insert(disclose(id), disclose(score));
commitments.insertDefault(disclose(id));
commitments.lookup(disclose(id)).insert(disclose(id));
applicants.insertHash(disclose(id));
```

`Set` and `Map` are unbounded ledger ADTs. `MerkleTree<depth, value_type>` is
bounded, and the official reference currently permits depths from 2 through 32.
Any iteration used in a circuit still needs a static bound; ledger ADT iterators
documented by Midnight are TypeScript-only.

## Constructor, witness, and circuits

```compact
constructor() {
  phase = Phase.SETUP;
}

witness reviewerSecret(): Bytes<32>;

export circuit commitScore(applicationId: Bytes<32>): [] {
  // Circuit body
}
```

Witness implementations live in TypeScript. In the current official example they
receive a `WitnessContext<Ledger, PrivateState>` and return a tuple:

```typescript
[nextPrivateState, witnessValue];
```

The current protocol import path used by the example is:

```typescript
import type { WitnessContext } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
```

## Disclosure rule

Private witness values and exported circuit arguments can require explicit
disclosure before they are stored in public ledger state:

```compact
scoreCommitments.insert(disclose(commitment));
```

`disclose()` records an explicit privacy decision; it is not a cryptographic
transform. Keep it as close as possible to the public ledger write, and add an
adjacent comment explaining why that exact value is safe to publish.

AEQUIRA must never disclose applicant or reviewer secrets, private attributes,
salts, nonces, Merkle paths, unrevealed scores, or conflict reasons.

L1's hashed reviewer `Set` is a deliberate temporary limitation: querying
membership requires disclosing which public pseudonym is accessed. This prevents
raw-secret disclosure but remains linkable to the organizer. Private Merkle
membership is required in L2 before claiming reviewer unlinkability.

## Administrator authentication

The L1 phase circuits use the same compiler-verified hash-preimage pattern as the
official lock/bulletin-board examples:

- constructor stores a domain-separated hash of the admin secret and round ID
- the admin secret remains in the TypeScript private state and is returned by a
  witness
- privileged circuits assert that the witness preimage matches the stored
  authority
- phase circuits permit only `SETUP -> APPLY -> REVIEW -> REVEAL`

Local simulator tests verified wrong-secret rejection and one-way phase guards.

## Hashes and commitments

The verified standard-library signatures are:

```compact
circuit transientHash<T>(value: T): Field;
circuit transientCommit<T>(value: T, rand: Field): Field;
circuit persistentHash<T>(value: T): Bytes<32>;
circuit persistentCommit<T>(value: T, rand: Bytes<32>): Bytes<32>;
```

Use a domain-separation value in hashes and a fresh random salt for commitments.
Low-entropy values such as scores must never be committed without a salt.

## Build command and generated output

The verified compiler form is:

```bash
compact compile packages/contract/src/aequira.compact \
  packages/contract/src/managed/aequira
```

`src/managed/` is generated output, is ignored by Git, and must not be edited by
hand.

Compiler `0.31.1` printed the number of circuits but did not print `k` or `rows`
with the default command. No supported statistics flag was identified in the
current CLI help, so constraint metrics remain an explicit follow-up instead of
being guessed.

## Still unresolved before the relevant circuit

- The exact circuit-side method for verifying an off-chain Merkle path against a
  stored root has not yet been proven. The plan's placeholder
  `applicantMerkleVerify(...)` must not be copied as though it exists.
- Constraint statistics need a supported compiler or artifact inspection method
  before the heavy `apply` circuit is accepted.
