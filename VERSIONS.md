# AEQUIRA Version Matrix

> Status: bootstrap baseline; the complete Midnight combination is not yet
> validated. Do not describe pending entries as a working toolchain.
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

| Component                            | Version | Status                                             |
| ------------------------------------ | ------- | -------------------------------------------------- |
| Compact toolchain                    | Pending | Install and verify with `compact check`            |
| Compact compiler                     | Pending | Record `compact compile --version` or tool output  |
| Compact language version             | Pending | Copy from a successfully compiled official example |
| `@midnight-ntwrk/compact-runtime`    | Pending | Resolve against the official compatibility matrix  |
| `@midnight-ntwrk/midnight-js-*`      | Pending | Resolve against the official compatibility matrix  |
| `@midnight-ntwrk/dapp-connector-api` | Pending | Resolve against the official compatibility matrix  |
| `@midnight-ntwrk/testkit-js`         | Pending | Resolve against the official compatibility matrix  |
| Ledger / on-chain runtime            | Pending | Resolve against the official compatibility matrix  |
| Proof server image                   | Pending | Verify the running Docker image                    |
| Indexer                              | Pending | Verify against the selected network stack          |
| Lace                                 | Pending | Verify during the L2 wallet milestone              |

The current official bulletin-board example documents Compact compiler `0.31.0`
and proof-server `8.0.3`. These are reference candidates, not yet a verified
AEQUIRA combination.
