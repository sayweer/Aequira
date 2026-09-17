# AEQUIRA Version Matrix

> Status: Compact development baseline, Docker-backed proof server and Preprod
> deployment all verified. Change a pinned version only after checking the
> current official compatibility matrix and compiling the official example.
>
> Last checked: 2026-09-17

## Workspace baseline

| Component              | Version | Evidence                                                            |
| ---------------------- | ------- | ------------------------------------------------------------------- |
| Node.js target         | 24.11.1 | Current official `midnightntwrk/example-bboard` `.nvmrc` and README |
| Local Node.js observed | 26.0.0  | `node --version`                                                    |
| pnpm                   | 11.9.0  | `pnpm --version`                                                    |
| TypeScript             | 5.9.3   | Root `package.json`                                                 |
| Docker Desktop         | 4.87.0  | Running local installation                                          |
| Docker Engine          | 29.7.2  | `docker version`                                                    |
| Docker Compose         | 5.4.0   | `docker compose version`                                            |

## Midnight compatibility

| Component                             | Version         | Evidence / status                                      |
| ------------------------------------- | --------------- | ------------------------------------------------------ |
| Compact devtools (`compact`)          | 0.5.1           | Installed; `compact --version`                         |
| Compact compiler / toolchain          | 0.31.1          | Installed; `compact compile --version`; check is green |
| Compact language version              | 0.23.0          | Compiler output and compiled official example          |
| `@midnight-ntwrk/compact-runtime`     | 0.16.0          | Installed direct dependency                            |
| `@midnight-ntwrk/compact-js`          | 2.5.1           | Installed through `midnight-js-protocol`               |
| Platform JS                           | 2.2.4           | Installed through `midnight-js-protocol`               |
| `midnight-js-protocol`                | 4.1.1           | Installed direct dependency                            |
| `midnight-js-network-id`              | 4.1.1           | Installed in contract tests and CLI runtime            |
| Other `@midnight-ntwrk/midnight-js-*` | 4.1.1           | Narrow CLI provider dependencies installed             |
| `@midnight-ntwrk/dapp-connector-api`  | 4.0.1           | Installed and used by the browser app                  |
| `@midnight-ntwrk/testkit-js`          | 4.1.1           | Official matrix and current example; install pending   |
| Wallet SDK                            | 1.2.0           | Installed direct CLI dependency                        |
| Ledger / on-chain runtime             | 8.1.0 / 3.0.0   | Installed transitively through the Compact stack       |
| Preprod node                          | 1.0.0           | Official compatibility matrix; remote service          |
| Midnight Indexer                      | 4.3.3           | Official compatibility matrix; remote service          |
| Proof server image                    | 8.1.0           | Loopback-only; AEQUIRA deploy proof verified           |
| Lace                                  | Connector 4.0.1 | Connected on Preprod; deployed the current contract    |

## Verification record

The official `midnightntwrk/example-bboard` source at commit
`c56dfa27d40b2dcdbe24c511d2d313d762e16a1c` (2026-07-28) passed its contract
pipeline locally: Compact compile, TypeScript typecheck, ESLint, build, and 9
Vitest tests.

The pinned `midnightntwrk/proof-server:8.1.0` ARM64 image runs locally with
digest `sha256:801bbc0340e9e96f16735f77b523f23c7459e3359842f7c79c2c53f4e994d531`.
Docker publishes its port only on `127.0.0.1:6300`; the root endpoint returned
HTTP 200 after all downloaded Zswap and Dust proving material was verified. The
full Preprod `doctor` check passes for Node.js, 32 contract ZK assets, network
node, indexer, and proof server. A separate smoke test constructed an offline
AEQUIRA deploy transaction from the compiled contract and its generated ZK
assets, then successfully proved that transaction through the HTTP proof
provider. That smoke-test transaction was not balanced, funded, or submitted.

The contract has since been deployed to Preprod for real, from the browser app
through Lace. The current deployment is
`6c3ae6b59692c2a8e4a454a8cdccd21084ed665b01766c993c15244c42485272`, deploy
transaction
`e47dab524fa170c87ce1610bdc9153991668e596c6ffd4791944f9d4ccd9d8d3` in block
`2592893`, which the official Preprod indexer returns as a `ContractDeploy`.

Its dependency installation reported 16 transitive vulnerabilities. AEQUIRA
does not copy the example's lockfile or full dependency graph; dependencies will
be added narrowly and audited when each workspace needs them.

The AEQUIRA contract compiles 8 state-changing circuits. The repository now
passes 238 tracked `node:test` tests: 26 contract, 37 SDK, 113 browser, and 62
CLI/runtime tests. Tests and the generated `managed/` output are tracked in Git and
run in CI.
The CLI tests include encrypted-at-rest private-state checks, wrong-password
failure, storage and backup permission checks, seed consumption, wallet
lifecycle, prerequisite gating, secret cleanup, reviewer/admin orchestration,
sealed-score transaction handling, and a real encrypted backup/restore
round-trip through the Level provider. They also verify offline Preview/Preprod
funding-address derivation, network-specific address prefixes, synchronized
public funding-state reporting, idempotent NIGHT UTXO selection for Dust
registration, zero-Dust transaction gating, and failure-path wallet cleanup with
explicit ledger key clearing. The project-only development-wallet seed is held
in a network-scoped, AES-256-GCM encrypted, non-overwriting `0600` vault; its
password-derived key uses scrypt and its public metadata is authenticated.
Backup format v2 authenticates its public network/address envelope with a
password-derived HMAC.

`pnpm verify` and the production audit pass with no reported issues or known
vulnerabilities. Native dependency scripts remain deny-by-default:
`classic-level@3.0.0` alone is allowed because the encrypted LevelDB provider
requires its N-API binding; the optional `msgpackr-extract` script remains
disabled. CLI diagnostics independently report selected-network node, indexer,
and local proof-server reachability before deploy secrets are requested.
