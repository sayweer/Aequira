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
- CLI configuration, offline funding-address derivation, network-synced funding
  status, idempotent NIGHT-to-Dust registration, diagnostics, deploy, join,
  sealed-score commit, and score reveal commands for Preview and Preprod
- a Wallet SDK runtime with account-scoped encrypted private-state storage
- encrypted, password-authenticated, non-overwriting runtime backups with
  restrictive filesystem permissions
- 48 local tests covering the contract, SDK inputs, wallet lifecycle, encrypted
  storage, backup safety, and deployment/sealed-score orchestration

The L1 reviewer allowlist is intentionally temporary: membership access reveals
which pseudonymous reviewer acts. L2 will replace it with private Merkle
membership before the contract can claim reviewer unlinkability.

No contract is deployed yet. Docker-backed proof-server verification remains
pending.

## Requirements

- Node.js `24.11.1` or newer (`.nvmrc` pins the verified official-example baseline)
- pnpm `11.9.0`
- Compact devtools `0.5.1`
- Docker Desktop (required for the local proof server; not yet available on the
  current development machine)

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

Derive the public unshielded address to fund on Preprod:

```bash
pnpm --filter @aequira/cli start wallet-address --network preprod
```

The command reads the wallet seed through a masked prompt, prints only the public
address, and does not start the wallet network client or require the local
private-state password.

After using the selected network's faucet, synchronize the wallet and inspect its
public funding state:

```bash
pnpm --filter @aequira/cli start funding-status --network preprod
```

This command also uses only the masked wallet seed. It connects to the selected
network, returns NIGHT and Dust balances as atomic-unit strings, and always closes
the wallet while clearing its derived SDK key material. `hasDust` reports only
whether the current Dust balance is positive; it does not guarantee that the
balance covers a particular transaction.

Register every currently available, unregistered NIGHT UTXO for Dust generation:

```bash
pnpm --filter @aequira/cli start register-dust --network preprod
```

The command submits at most one registration transaction. If there is no
eligible NIGHT UTXO, it returns `submitted: false` without creating a
transaction. Run `funding-status` again after the registration is processed to
observe the current Dust balance.

Start the matrix-pinned proof server on the loopback interface:

```bash
pnpm proof-server:up
```

The proof server processes private proving inputs, so the tracked Compose file
publishes port `6300` only on `127.0.0.1`. Stop it with
`pnpm proof-server:down`.

Inspect the public Preprod configuration:

```bash
pnpm --filter @aequira/cli start config --network preprod --json
```

Check Node, compiled ZK assets, and the local proof server:

```bash
pnpm --filter @aequira/cli doctor
```

After `doctor` passes, deploy using a public 32-byte round identifier:

```bash
pnpm --filter @aequira/cli start deploy --network preprod --round-id ROUND_ID_64_HEX
```

Join an existing deployment:

```bash
pnpm --filter @aequira/cli start join --network preprod --contract-address CONTRACT_ADDRESS
```

`join` returns the account's public reviewer pseudonym. During setup, the
organizer can register that value and then advance the round:

```bash
pnpm --filter @aequira/cli start register-reviewer --network preprod --contract-address CONTRACT_ADDRESS --reviewer-id REVIEWER_ID_64_HEX
pnpm --filter @aequira/cli start open-applications --network preprod --contract-address CONTRACT_ADDRESS
pnpm --filter @aequira/cli start open-review --network preprod --contract-address CONTRACT_ADDRESS
```

Commit a score during the review phase:

```bash
pnpm --filter @aequira/cli start commit-score --network preprod --contract-address CONTRACT_ADDRESS --application-id APPLICATION_ID_64_HEX
```

Reveal the same score during the reveal phase:

```bash
pnpm --filter @aequira/cli start open-reveal --network preprod --contract-address CONTRACT_ADDRESS
pnpm --filter @aequira/cli start reveal-score --network preprod --contract-address CONTRACT_ADDRESS --application-id APPLICATION_ID_64_HEX
```

Commands that access private state prompt for the wallet seed and private-state
password through an interactive, masked terminal input. `commit-score` also
prompts for the private score and generates its salt internally; neither value
is accepted through process arguments. Successful state-changing commands create
an encrypted backup under the ignored private-state directory. The backup does
not contain the wallet seed; preserve the seed and storage password separately.

Restore a copied backup into an empty local state store using the same wallet
seed and storage password:

```bash
pnpm --filter @aequira/cli start restore --network preprod --backup-file BACKUP_PATH
```

Restore validates the password-authenticated format, network, contract address,
file size, and owner-only permissions before opening private storage. It refuses
to overwrite existing contract state or signing keys.

The CLI intentionally rejects wallet seeds, private keys, passwords, and
contract secrets passed as command-line arguments.
