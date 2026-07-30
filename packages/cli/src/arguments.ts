import type { AequiraNetwork } from './config.js';

export const COMMANDS = ['config', 'deploy', 'doctor', 'help', 'join'] as const;

export type CliCommand = (typeof COMMANDS)[number];

export type CliArguments = {
  readonly command: CliCommand;
  readonly contractAddress?: string;
  readonly json: boolean;
  readonly network?: AequiraNetwork;
  readonly proofServer?: string;
  readonly roundId?: string;
};

const SENSITIVE_OPTIONS = new Set([
  '--admin-secret',
  '--mnemonic',
  '--password',
  '--private-key',
  '--reviewer-secret',
  '--score-salt',
  '--seed',
  '--wallet-seed',
]);

const isSensitiveOption = (option: string): boolean => {
  const [name = option] = option.split('=', 1);
  return (
    SENSITIVE_OPTIONS.has(name) ||
    /(?:secret|seed|mnemonic|password|private[-_]?key|salt)/i.test(name)
  );
};

const readOptionValue = (argv: readonly string[], index: number, option: string): string => {
  const value = argv[index + 1];

  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${option} requires a value`);
  }

  return value;
};

export const parseCliArguments = (argv: readonly string[]): CliArguments => {
  const [commandValue = 'help', ...options] = argv;

  if (!COMMANDS.includes(commandValue as CliCommand)) {
    throw new Error(`Unknown command "${commandValue}"`);
  }

  let json = false;
  let contractAddress: string | undefined;
  let network: AequiraNetwork | undefined;
  let proofServer: string | undefined;
  let roundId: string | undefined;

  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];

    if (option === undefined) {
      continue;
    }

    if (isSensitiveOption(option)) {
      const [optionName = 'sensitive option'] = option.split('=', 1);
      throw new Error(
        `${optionName} is forbidden: secrets must never be passed through command-line arguments`,
      );
    }

    if (option === '--json') {
      json = true;
      continue;
    }

    if (option === '--network') {
      network = readOptionValue(options, index, option) as AequiraNetwork;
      index += 1;
      continue;
    }

    if (option === '--proof-server-url') {
      proofServer = readOptionValue(options, index, option);
      index += 1;
      continue;
    }

    if (option === '--round-id') {
      roundId = readOptionValue(options, index, option);
      index += 1;
      continue;
    }

    if (option === '--contract-address') {
      contractAddress = readOptionValue(options, index, option);
      index += 1;
      continue;
    }

    throw new Error(`Unknown option "${option}"`);
  }

  if (commandValue === 'deploy' && roundId === undefined) {
    throw new Error('deploy requires --round-id');
  }

  if (commandValue !== 'deploy' && roundId !== undefined) {
    throw new Error('--round-id is only valid with deploy');
  }

  if (commandValue === 'join' && contractAddress === undefined) {
    throw new Error('join requires --contract-address');
  }

  if (commandValue !== 'join' && contractAddress !== undefined) {
    throw new Error('--contract-address is only valid with join');
  }

  return {
    command: commandValue as CliCommand,
    json,
    ...(contractAddress === undefined ? {} : { contractAddress }),
    ...(network === undefined ? {} : { network }),
    ...(proofServer === undefined ? {} : { proofServer }),
    ...(roundId === undefined ? {} : { roundId }),
  };
};
