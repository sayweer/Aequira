# AEQUIRA Version Matrix

> Status: Compact development baseline and Docker-backed proof server verified;
> Preprod deployment pending. Change a pinned version only after checking the
> current official compatibility matrix and compiling the official example.
>
> Last checked: 2026-07-30

## Workspace baseline

| Component              | Version | Evidence                                                            |
| ---------------------- | ------- | ------------------------------------------------------------------- |
| Node.js target         | 24.11.1 | Current official `midnightntwrk/example-bboard` `.nvmrc` and README |
| Local Node.js observed | 26.0.0  | `node --version`                                                    |
| pnpm                   | 11.9.0  | `pnpm --version`                                                    |
| TypeScript             | 5.9.3   | Root `package.json`                                                 |
| Docker Desktop         | 4.84.0  | Running local installation                                          |
| Docker Engine          | 29.6.2  | `docker version`                                                    |
| Docker Compose         | 5.3.1   | `docker compose version`                                            |

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
| Proof server image                    | 8.1.0         | Running on `127.0.0.1:6300`; HTTP 200 verified         |
| Lace                                  | Pending       | Verify during the L2 wallet milestone                  |

## Verification record

The official `midnightntwrk/example-bboard` source at commit
`c56dfa27d40b2dcdbe24c511d2d313d762e16a1c` (2026-07-28) passed its contract
pipeline locally: Compact compile, TypeScript typecheck, ESLint, build, and 9
Vitest tests.

The pinned `midnightntwrk/proof-server:8.1.0` ARM64 image runs locally with
digest `sha256:801bbc0340e9e96f16735f77b523f23c7459e3359842f7c79c2c53f4e994d531`.
Docker publishes its port only on `127.0.0.1:6300`; the root endpoint returned
HTTP 200 after all downloaded Zswap and Dust proving material was verified. The
full Preprod `doctor` check passes for Node.js, 18 contract ZK assets, network
node, indexer, and proof server.

Its dependency installation reported 16 transitive vulnerabilities. AEQUIRA
does not copy the example's lockfile or full dependency graph; dependencies will
be added narrowly and audited when each workspace needs them.

The AEQUIRA L1 contract compiled 6 state-changing circuits. The repository now
passes 48 local `node:test` tests: 10 contract, 4 SDK, and 34 CLI/runtime tests.
The CLI tests include encrypted-at-rest private-state checks, wrong-password
failure, storage and backup permission checks, seed consumption, wallet
lifecycle, prerequisite gating, secret cleanup, reviewer/admin orchestration,
sealed-score transaction handling, and a real encrypted backup/restore
round-trip through the Level provider. They also verify offline Preview/Preprod
funding-address derivation, network-specific address prefixes, synchronized
public funding-state reporting, idempotent NIGHT UTXO selection for Dust
registration, zero-Dust transaction gating, and failure-path wallet cleanup with
explicit ledger key clearing. Backup format v2 authenticates its public
network/address envelope with a password-derived HMAC.

`pnpm verify` and the production audit pass with no reported issues or known
vulnerabilities. Native dependency scripts remain deny-by-default:
`classic-level@3.0.0` alone is allowed because the encrypted LevelDB provider
requires its N-API binding; the optional `msgpackr-extract` script remains
disabled. CLI diagnostics independently report selected-network node, indexer,
and local proof-server reachability before deploy secrets are requested.
