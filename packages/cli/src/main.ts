#!/usr/bin/env node

import { parseCliArguments } from './arguments.js';
import { runDeployCommand, runJoinCommand } from './commands.js';
import { loadCliConfig } from './config.js';
import { runDoctor } from './doctor.js';
import { redactErrorMessage } from './errors.js';

const HELP = `AEQUIRA CLI

Usage:
  aequira config [--network preview|preprod] [--proof-server-url URL] [--json]
  aequira doctor [--network preview|preprod] [--proof-server-url URL] [--json]
  aequira deploy --round-id 64_HEX [--network preview|preprod] [--json]
  aequira join --contract-address ADDRESS [--network preview|preprod] [--json]

Secrets are intentionally not accepted as command-line arguments.
Deploy and join require an interactive TTY for masked secret entry.
`;

const write = (value: string): void => {
  process.stdout.write(`${value}\n`);
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

  if (args.command === 'deploy') {
    if (args.roundId === undefined) {
      throw new Error('deploy requires --round-id');
    }

    const result = await runDeployCommand(config, args.roundId);
    write(JSON.stringify(result, null, args.json ? 2 : 0));

    if (!args.json) {
      write(
        'Backup created. It does not contain the wallet seed; preserve the seed and storage password separately.',
      );
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
      write(
        'Backup created. It does not contain the wallet seed; preserve the seed and storage password separately.',
      );
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
