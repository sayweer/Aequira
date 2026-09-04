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

`insertHash` compiles, but see "Merkle membership" below before choosing it over
`insert` — they use different leaf encodings and only one of them is findable
from TypeScript.

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

Querying a `Set` for membership requires disclosing which element is looked up,
which is why `commitScore` no longer authorizes that way. The roster `Set`
remains, but it is queried only by `registerReviewer`, where the administrator is
naming the pseudonym anyway. Membership at commit time is proven against a
`MerkleTree` instead — see "Merkle membership" below.

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

## Merkle membership

Verified on 2026-08-27 by compiling and running the real circuits, not by
reading documentation. The plan's placeholder `applicantMerkleVerify(...)` does
not exist and must never be copied; the standard library provides these instead:

```compact
circuit merkleTreePathRoot<#n, T>(path: MerkleTreePath<n, T>): MerkleTreeDigest;
circuit merkleTreePathRootNoLeafHash<#n>(path: MerkleTreePath<n, Bytes<32>>): MerkleTreeDigest;
```

Neither name appears on `docs.midnight.network`. They are documented in
`midnightntwrk/midnight-expert` and used in production by `midnight-ledger`'s
`zswap.compact` and `dust.compact`.

AEQUIRA's working form:

```compact
export ledger reviewerTree: MerkleTree<10, Bytes<32>>;

witness reviewerMerklePath(): MerkleTreePath<10, Bytes<32>>;

// registerReviewer
reviewerTree.insert(publicReviewerId);

// commitScore
const path = reviewerMerklePath();
assert(path.leaf == reviewerId(secret), "Membership proof is not for this reviewer");
const membershipRoot = merkleTreePathRoot<10, Bytes<32>>(path);
assert(reviewerTree.checkRoot(disclose(membershipRoot)), "Reviewer is not registered");
```

**`insert` and `insertHash` are not interchangeable.** `insertHash(x)` stores `x`
as the leaf digest and pairs with `merkleTreePathRootNoLeafHash`. The generated
TypeScript `findPathForLeaf(leaf)` hashes its argument, so it returns `undefined`
for a tree filled with `insertHash`, even though `firstFree()` and
`pathForLeaf(index, leaf)` both show the leaf is there. Using `insert` plus
`merkleTreePathRoot` keeps the write path, the lookup and the circuit on the same
encoding. There is no `findPathForLeafHash`.

The witness reads the path from the ledger — `WitnessContext` carries it — so no
off-chain Merkle implementation is needed:

```typescript
const leaf = pureCircuits.reviewerId(privateState.reviewerSecret);
const path = ledger.reviewerTree.findPathForLeaf(leaf);
```

**The leaf must be bound to the caller.** The witness chooses `path.leaf`, so
without the `path.leaf == reviewerId(secret)` assertion any caller could present a
registered member's leaf and path while deriving the nullifier from their own
secret, defeating replay protection entirely.

## Circuit cost, measured rather than guessed

Verified on 2026-09-04 with the same toolchain, by compiling the contract with
`apply` present.

Compiler 0.31.1 still prints neither `k` nor `rows`, but the generated artifacts
answer the question directly. The instruction count in
`src/managed/aequira/zkir/<circuit>.zkir` is a faithful size proxy, and the
prover key size shows which power-of-two class the circuit lands in:

| Circuit             | ZKIR instructions | Prover key |
| ------------------- | ----------------- | ---------- |
| `apply`             | 283               | 9.98 MB    |
| `commitScore`       | 248               | 9.99 MB    |
| `revealScore`       | 245               | 5.21 MB    |
| `registerReviewer`  | 159               | 2.82 MB    |
| `registerApplicant` | 112               | 2.82 MB    |

Read it with:

```bash
python3 -c "
import json, glob, os
for f in sorted(glob.glob('packages/contract/src/managed/aequira/zkir/*.zkir')):
    print(os.path.basename(f), len(json.load(open(f))['instructions']))
"
```

`apply` was expected to be the heavy one — a Merkle path, a five-element
commitment and two comparisons. It is 14% larger than `commitScore` and shares
its prover-key size class, which is the circuit that already proves in the
browser. There was no need to reduce the Merkle depth.

## Applicant attribute encoding

- Numeric witnesses cast to hash payload elements the same way a score does:
  `incomeBand as Bytes<32>` compiles for `Uint<8>` as well as `Uint<16>`. The
  plan's `u8ToBytes`/`u16ToBytes` helpers do not exist.
- The three attributes are declared as three separate witnesses rather than one
  tuple-returning witness. A tuple return has not been verified against this
  language version, and three witnesses cost nothing extra.
- Comparing a private witness against a public ledger field inside `assert`
  needs no `disclose()`: only the verdict leaves the circuit, and it leaves only
  as the fact that a proof was accepted.

## Still unresolved

- Nothing blocking. The `claim` circuit will need `applicationPseudonym` to be
  reproducible from `(roundId, applicantSecret, nonce)` alone, which is why the
  nonce — not the enrollment salt — is its commitment randomness.
