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
- Admin authorization primitives must be verified against a current official
  contract before `openRound` or `advancePhase` is implemented.
- Constraint statistics need a supported compiler or artifact inspection method
  before the heavy `apply` circuit is accepted.
