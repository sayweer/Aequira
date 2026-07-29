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
- `packages/sdk` — off-chain Merkle, credential, secret, and provider helpers
- `packages/cli` — organizer and integration CLI
- `packages/ui` — web application

## Current status

AEQUIRA is in L1-A bootstrap. The workspace and version policy are being
established before contract code is written. No contract is deployed yet.

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
