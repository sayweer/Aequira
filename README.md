# AEQUIRA

AEQUIRA is a privacy-preserving decision layer for scholarships and grants, built
on Midnight Network.

Applicants prove eligibility without exposing their underlying personal data.
Reviewers score anonymous applications through a sealed commit–reveal flow, and
the final decision remains publicly auditable against the announced rules.

## Product principles

- Eligibility is proven without publishing raw income, GPA, or regional data.
- Applicant identity stays hidden from the review panel.
- Scores stay sealed until the reveal phase.
- Conflict-of-interest recusal is enforced without publishing its reason.
- The final outcome can be audited without a wallet.

## Repository

This repository is a pnpm monorepo:

- `packages/contract` — Compact smart contract
- `packages/sdk` — typed contract deployment and provider boundary
- `packages/cli` — organizer and integration CLI
- `packages/ui` — web application

## Current status

AEQUIRA has its first L1 contract slice:

- administrator-only, one-way phase transitions through setup, apply, review,
  and reveal
- a temporary public hashed reviewer allowlist
- sealed score commitments with application-scoped replay protection
- score opening and per-application aggregation
- a deployable `CompiledContract` bundle containing the required ZK assets
- a typed SDK for deploy, join, private-state validation, and ledger queries
- a CLI configuration/doctor slice for Preview and Preprod
- 18 local tests covering the contract, SDK inputs, and CLI safety

The L1 reviewer allowlist is intentionally temporary: membership access reveals
which pseudonymous reviewer acts. L2 will replace it with private Merkle
membership before the contract can claim reviewer unlinkability.

No contract is deployed yet. Docker-backed proof-server verification remains
pending.

## Requirements

- Node.js `24.11.1` or newer (`.nvmrc` pins the verified official-example baseline)
- pnpm `11.9.0`
- Compact toolchain and Docker (installation verification is still pending)

Install the JavaScript workspace:

```bash
pnpm install
```

Run all currently available checks:

```bash
pnpm verify
```

Compile only the Compact contract:

```bash
pnpm compact:build
```

Inspect the public Preprod configuration:

```bash
pnpm --filter @aequira/cli start config --network preprod --json
```

Check Node, compiled ZK assets, and the local proof server:

```bash
pnpm --filter @aequira/cli doctor
```

The CLI intentionally rejects wallet seeds, private keys, passwords, and
contract secrets passed as command-line arguments.
