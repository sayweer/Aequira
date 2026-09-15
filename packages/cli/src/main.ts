#!/usr/bin/env node

import { parseCliArguments } from './arguments.js';
import {
  runApplyCommand,
  runCommitScoreCommand,
  runDeployCommand,
  runFundingStatusCommand,
  runImportEnrollmentCommand,
  runJoinCommand,
  runPhaseCommand,
  runRegisterApplicantCommand,
  runRegisterDustCommand,
  runRegisterReviewerCommand,
  runRestoreCommand,
  runRevealScoreCommand,
  runRoundStatusCommand,
  runWalletAddressCommand,
  runWalletCreateCommand,
} from './commands.js';
import { loadCliConfig } from './config.js';
import { runDoctor } from './doctor.js';
import { redactErrorMessage } from './errors.js';

const HELP = `AEQUIRA CLI

Usage:
  aequira config [--network preview|preprod] [--proof-server-url URL] [--json]
  aequira doctor [--network preview|preprod] [--proof-server-url URL] [--json]
  aequira wallet-create [--network preview|preprod] [--json]
  aequira wallet-address [--network preview|preprod] [--json]
  aequira funding-status [--network preview|preprod] [--json]
  aequira register-dust [--dust-address <mn_dust_...>] [--network preview|preprod] [--json]
  aequira deploy --round-id 64_HEX --max-income-band 0-255 --min-gpa-scaled 0-65535 [--network preview|preprod] [--json]
  aequira join --contract-address ADDRESS [--network preview|preprod] [--json]
  aequira restore --backup-file PATH [--network preview|preprod] [--json]
  aequira register-reviewer --contract-address ADDRESS --reviewer-id 64_HEX [--network preview|preprod] [--json]
  aequira register-applicant --contract-address ADDRESS --applicant-id 64_HEX [--network preview|preprod] [--json]
  aequira import-enrollment --contract-address ADDRESS [--network preview|preprod] [--json]
  aequira open-applications --contract-address ADDRESS [--network preview|preprod] [--json]
  aequira apply --contract-address ADDRESS [--network preview|preprod] [--json]
  aequira open-review --contract-address ADDRESS [--network preview|preprod] [--json]
  aequira commit-score --contract-address ADDRESS --application-id 64_HEX [--network preview|preprod] [--json]
  aequira open-reveal --contract-address ADDRESS [--network preview|preprod] [--json]
  aequira reveal-score --contract-address ADDRESS --application-id 64_HEX [--network preview|preprod] [--json]
  aequira round-status --contract-address ADDRESS [--network preview|preprod] [--json]

Secrets are intentionally not accepted as command-line arguments.
wallet-create stores a new Wallet SDK seed in an encrypted, local-only vault.
Wallet and private-state commands require an interactive TTY for masked secret entry.
Enrollment: the applicant runs join and hands its applicantId to the institution.
The institution verifies the attributes, runs register-applicant (masked prompts)
and passes the printed enrollmentReceipt to the applicant privately; the
applicant runs import-enrollment before apply.
round-status reads the public ledger only and needs no wallet or password.
`;

const write = (value: string): void => {
  process.stdout.write(`${value}\n`);
};

const writeBackupReminder = (): void => {
  write(
    'Backup created. It does not contain the wallet vault; preserve the encrypted vault and both passwords separately.',
  );
};

const main = async (): Promise<void> => {
  const args = parseCliArguments(process.argv.slice(2));

  if (args.command === 'help') {
    write(HELP);
    return;
  }

  const config = loadCliConfig({
    ...(args.network === undefined ? {} : { network: args.network }),
    ...(args.proofServer === undefined ? {} : { proofServer: args.proofServer }),
  });

  if (args.command === 'config') {
    write(JSON.stringify(config, null, args.json ? 2 : 0));
    return;
  }

  if (args.command === 'wallet-create') {
    const result = await runWalletCreateCommand(config);
    write(JSON.stringify(result, null, args.json ? 2 : 0));

    if (!args.json) {
      write(
        'Encrypted development wallet created. Back up the vault file and keep its password outside the repository.',
      );
    }
    return;
  }

  if (args.command === 'wallet-address') {
    const result = await runWalletAddressCommand(config);
    write(JSON.stringify(result, null, args.json ? 2 : 0));
    return;
  }

  if (args.command === 'funding-status') {
    const result = await runFundingStatusCommand(config);
    write(JSON.stringify(result, null, args.json ? 2 : 0));
    return;
  }

  if (args.command === 'register-dust') {
    const result = await runRegisterDustCommand(config, args.dustAddress);
    write(JSON.stringify(result, null, args.json ? 2 : 0));
    return;
  }

  if (args.command === 'restore') {
    if (args.backupFile === undefined) {
      throw new Error('restore requires --backup-file');
    }

    const result = await runRestoreCommand(config, args.backupFile);
    write(JSON.stringify(result, null, args.json ? 2 : 0));

    if (!args.json) {
      write(
        'Restore completed without overwriting existing state. Preserve the encrypted wallet vault and both passwords separately.',
      );
    }
    return;
  }

  if (args.command === 'deploy') {
    if (args.roundId === undefined) {
      throw new Error('deploy requires --round-id');
    }

    if (args.maxIncomeBand === undefined) {
      throw new Error('deploy requires --max-income-band');
    }

    if (args.minGpaScaled === undefined) {
      throw new Error('deploy requires --min-gpa-scaled');
    }

    const result = await runDeployCommand(
      config,
      args.roundId,
      args.maxIncomeBand,
      args.minGpaScaled,
    );
    write(JSON.stringify(result, null, args.json ? 2 : 0));

    if (!args.json) {
      writeBackupReminder();
    }
    return;
  }

  if (args.command === 'join') {
    if (args.contractAddress === undefined) {
      throw new Error('join requires --contract-address');
    }

    const result = await runJoinCommand(config, args.contractAddress);
    write(JSON.stringify(result, null, args.json ? 2 : 0));

    if (!args.json) {
      writeBackupReminder();
    }
    return;
  }

  if (args.command === 'commit-score' || args.command === 'reveal-score') {
    if (args.contractAddress === undefined || args.applicationId === undefined) {
      throw new Error(`${args.command} requires --contract-address and --application-id`);
    }

    const result =
      args.command === 'commit-score'
        ? await runCommitScoreCommand(config, args.contractAddress, args.applicationId)
        : await runRevealScoreCommand(config, args.contractAddress, args.applicationId);
    write(JSON.stringify(result, null, args.json ? 2 : 0));

    if (!args.json) {
      writeBackupReminder();
    }
    return;
  }

  if (args.command === 'register-reviewer') {
    if (args.contractAddress === undefined || args.reviewerId === undefined) {
      throw new Error('register-reviewer requires --contract-address and --reviewer-id');
    }

    const result = await runRegisterReviewerCommand(config, args.contractAddress, args.reviewerId);
    write(JSON.stringify(result, null, args.json ? 2 : 0));

    if (!args.json) {
      writeBackupReminder();
    }
    return;
  }

  if (args.command === 'register-applicant') {
    if (args.contractAddress === undefined || args.applicantId === undefined) {
      throw new Error('register-applicant requires --contract-address and --applicant-id');
    }

    const result = await runRegisterApplicantCommand(
      config,
      args.contractAddress,
      args.applicantId,
    );
    write(JSON.stringify(result, null, args.json ? 2 : 0));

    if (!args.json) {
      write(
        'enrollmentReceipt contains the verified attributes and salt. Give it to the applicant privately, never through a public channel; they import it with import-enrollment.',
      );
    }
    return;
  }

  if (args.command === 'import-enrollment') {
    if (args.contractAddress === undefined) {
      throw new Error('import-enrollment requires --contract-address');
    }

    const result = await runImportEnrollmentCommand(config, args.contractAddress);
    write(JSON.stringify(result, null, args.json ? 2 : 0));

    if (!args.json) {
      if (!result.enrolledOnChain) {
        write(
          'The receipt is valid, but its leaf is not on chain yet. Wait for the institution’s registration to finalize before applying.',
        );
      }
      writeBackupReminder();
    }
    return;
  }

  if (args.command === 'round-status') {
    if (args.contractAddress === undefined) {
      throw new Error('round-status requires --contract-address');
    }

    const result = await runRoundStatusCommand(config, args.contractAddress);
    write(JSON.stringify(result, null, args.json ? 2 : 0));
    return;
  }

  if (args.command === 'apply') {
    if (args.contractAddress === undefined) {
      throw new Error('apply requires --contract-address');
    }

    const result = await runApplyCommand(config, args.contractAddress);
    write(JSON.stringify(result, null, args.json ? 2 : 0));

    if (!args.json) {
      writeBackupReminder();
    }
    return;
  }

  if (
    args.command === 'open-applications' ||
    args.command === 'open-review' ||
    args.command === 'open-reveal'
  ) {
    if (args.contractAddress === undefined) {
      throw new Error(`${args.command} requires --contract-address`);
    }

    const result = await runPhaseCommand(config, args.contractAddress, args.command);
    write(JSON.stringify(result, null, args.json ? 2 : 0));

    if (!args.json) {
      writeBackupReminder();
    }
    return;
  }

  const checks = await runDoctor(config);

  if (args.json) {
    write(JSON.stringify(checks, null, 2));
  } else {
    for (const check of checks) {
      write(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`);
    }
  }

  if (checks.some((check) => !check.ok)) {
    process.exitCode = 1;
  }
};

main().catch((error: unknown) => {
  const message = redactErrorMessage(error);
  process.stderr.write(`AEQUIRA CLI error: ${message}\n`);
  process.exitCode = 1;
});
