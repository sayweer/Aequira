#!/usr/bin/env node

import { parseCliArguments } from './arguments.js';
import { loadCliConfig } from './config.js';
import { runDoctor } from './doctor.js';

const HELP = `AEQUIRA CLI

Usage:
  aequira config [--network preview|preprod] [--proof-server-url URL] [--json]
  aequira doctor [--network preview|preprod] [--proof-server-url URL] [--json]

Secrets are intentionally not accepted as command-line arguments.
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
  const message = error instanceof Error ? error.message : 'Unknown CLI error';
  process.stderr.write(`AEQUIRA CLI error: ${message}\n`);
  process.exitCode = 1;
});
