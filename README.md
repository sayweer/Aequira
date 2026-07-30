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
- a project-only development wallet whose Wallet SDK seed is encrypted at rest,
  network-scoped, non-overwriting, and excluded from Git
- a Wallet SDK runtime with account-scoped encrypted private-state storage
- encrypted, password-authenticated, non-overwriting runtime backups with
  restrictive filesystem permissions
- 50 local tests covering the contract, SDK inputs, wallet lifecycle, encrypted
  storage, backup safety, and deployment/sealed-score orchestration

The L1 reviewer allowlist is intentionally temporary: membership access reveals
which pseudonymous reviewer acts. L2 will replace it with private Merkle
membership before the contract can claim reviewer unlinkability.

No contract is deployed yet. The matrix-pinned proof server is verified locally
with an actual AEQUIRA deploy proof; the next L1 step is wallet funding and the
first Preprod deployment.

## Requirements

- Node.js `24.11.1` or newer (`.nvmrc` pins the verified official-example baseline)
- pnpm `11.9.0`
- Compact devtools `0.5.1`
- Docker Desktop `4.84.0` or another compatible Docker runtime

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

Create the project-only Preprod development wallet:

```bash
pnpm --filter @aequira/cli start wallet-create --network preprod
```

The command generates a fresh 32-byte Wallet SDK seed, encrypts it in the ignored
`.private-state/` directory, sets owner-only file permissions, and prints only
the public unshielded address and vault path. It refuses to overwrite an existing
vault. Back up the encrypted vault file outside the repository and preserve its
password separately.

This programmatic wallet flow does not require a browser extension and follows
Midnight's official
[Preprod DUST guide](https://docs.midnight.network/guides/generating-dust-programmatically).

Re-derive the public unshielded address to fund on Preprod:

```bash
pnpm --filter @aequira/cli start wallet-address --network preprod
```

The command unlocks the encrypted wallet through a masked password prompt, prints
only the public address, and does not start the wallet network client or require
the local private-state password.

Submit that public address to the official
[Preprod faucet](https://midnight-tmnight-preprod.nethermind.dev/). After the
tNIGHT arrives, synchronize the wallet and inspect its public funding state:

```bash
pnpm --filter @aequira/cli start funding-status --network preprod
```

This command also uses only the masked development-wallet password. It connects
to the selected network, returns NIGHT and Dust balances as atomic-unit strings,
and always closes the wallet while clearing its seed and derived SDK key
material. `hasDust` reports only whether the current Dust balance is positive; it
does not guarantee that the balance covers a particular transaction.

Register every currently available, unregistered NIGHT UTXO for Dust generation:

```bash
pnpm --filter @aequira/cli start register-dust --network preprod
```

The command submits at most one registration transaction. If there is no
eligible NIGHT UTXO, it returns `submitted: false` without creating a
transaction. Run `funding-status` again after the registration is processed to
observe the current Dust balance.

Deploy and state-changing contract commands stop before transaction construction
when the synchronized Dust balance is zero. A positive balance is still not a
guarantee that a particular transaction's full fee can be covered.

Start the matrix-pinned proof server on the loopback interface:

```bash
pnpm proof-server:up
```

The proof server processes private proving inputs, so the tracked Compose file
publishes port `6300` only on `127.0.0.1`. Stop it with
`pnpm proof-server:down`. The current ARM64 image has also generated a real
AEQUIRA deploy proof from an offline unproven transaction; that smoke test did
not balance, fund, or submit the transaction.

Inspect the public Preprod configuration:

```bash
pnpm --filter @aequira/cli start config --network preprod --json
```

Check Node.js, compiled ZK assets, the selected network node and indexer, and the
local proof server:

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

Commands that access private state prompt for the development-wallet password
and private-state password through interactive, masked terminal input.
`commit-score` also prompts for the private score and generates its salt
internally; neither value is accepted through process arguments. Successful
state-changing commands create an encrypted backup under the ignored
private-state directory. Runtime backups do not contain the wallet vault;
preserve the encrypted vault and both passwords separately.

Restore a copied backup into an empty local state store using the same encrypted
wallet vault and storage password:

```bash
pnpm --filter @aequira/cli start restore --network preprod --backup-file BACKUP_PATH
```

Restore validates the password-authenticated format, network, contract address,
file size, and owner-only permissions before opening private storage. It refuses
to overwrite existing contract state or signing keys.

The CLI intentionally rejects wallet seeds, private keys, passwords, and
contract secrets passed as command-line arguments.
