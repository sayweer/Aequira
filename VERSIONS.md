# AEQUIRA Version Matrix

> Status: Compact development baseline verified; Docker-backed proving remains
> pending. Change a pinned version only after checking the current official
> compatibility matrix and compiling the official example.
>
> Last checked: 2026-07-30

## Workspace baseline

| Component              | Version | Evidence                                                            |
| ---------------------- | ------- | ------------------------------------------------------------------- |
| Node.js target         | 24.11.1 | Current official `midnightntwrk/example-bboard` `.nvmrc` and README |
| Local Node.js observed | 26.0.0  | `node --version`                                                    |
| pnpm                   | 11.9.0  | `pnpm --version`                                                    |
| TypeScript             | 5.9.3   | Root `package.json`                                                 |

## Midnight compatibility

| Component                             | Version       | Evidence / status                                      |
| ------------------------------------- | ------------- | ------------------------------------------------------ |
| Compact devtools (`compact`)          | 0.5.1         | Installed; `compact --version`                         |
| Compact compiler / toolchain          | 0.31.1        | Installed; `compact compile --version`; check is green |
| Compact language version              | 0.23.0        | Compiler output and compiled official example          |
| `@midnight-ntwrk/compact-runtime`     | 0.16.0        | Installed direct dependency                            |
| `@midnight-ntwrk/compact-js`          | 2.5.1         | Installed through `midnight-js-protocol`               |
| Platform JS                           | 2.2.4         | Installed through `midnight-js-protocol`               |
| `midnight-js-protocol`                | 4.1.1         | Installed direct dependency                            |
| `midnight-js-network-id`              | 4.1.1         | Installed in contract tests and CLI runtime            |
| Other `@midnight-ntwrk/midnight-js-*` | 4.1.1         | Narrow CLI provider dependencies installed             |
| `@midnight-ntwrk/dapp-connector-api`  | 4.0.1         | Official matrix and current example; install pending   |
| `@midnight-ntwrk/testkit-js`          | 4.1.1         | Official matrix and current example; install pending   |
| Wallet SDK                            | 1.2.0         | Installed direct CLI dependency                        |
| Ledger / on-chain runtime             | 8.1.0 / 3.0.0 | Installed transitively through the Compact stack       |
| Preprod node                          | 1.0.0         | Official compatibility matrix; remote service          |
| Midnight Indexer                      | 4.3.3         | Official compatibility matrix; remote service          |
| Proof server image                    | 8.1.0         | Official compatibility matrix; Docker pending          |
| Lace                                  | Pending       | Verify during the L2 wallet milestone                  |

## Verification record

The official `midnightntwrk/example-bboard` source at commit
`c56dfa27d40b2dcdbe24c511d2d313d762e16a1c` (2026-07-28) passed its contract
pipeline locally: Compact compile, TypeScript typecheck, ESLint, build, and 9
Vitest tests.

Its dependency installation reported 16 transitive vulnerabilities. AEQUIRA
does not copy the example's lockfile or full dependency graph; dependencies will
be added narrowly and audited when each workspace needs them.

The AEQUIRA L1 contract compiled 6 state-changing circuits. The repository now
passes 33 local `node:test` tests: 10 contract, 3 SDK, and 20 CLI/runtime tests.
The CLI tests include encrypted-at-rest private-state checks, wrong-password
failure, storage and backup permission checks, seed consumption, wallet
lifecycle, prerequisite gating, secret cleanup, and deploy/join orchestration.

`pnpm verify` and the production audit pass with no reported issues or known
vulnerabilities. Native dependency scripts remain deny-by-default:
`classic-level@3.0.0` alone is allowed because the encrypted LevelDB provider
requires its N-API binding; the optional `msgpackr-extract` script remains
disabled.
