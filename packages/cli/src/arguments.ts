import type { AequiraNetwork } from './config.js';

export const COMMANDS = ['config', 'doctor', 'help'] as const;

export type CliCommand = (typeof COMMANDS)[number];

export type CliArguments = {
  readonly command: CliCommand;
  readonly json: boolean;
  readonly network?: AequiraNetwork;
  readonly proofServer?: string;
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
  let network: AequiraNetwork | undefined;
  let proofServer: string | undefined;

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

    throw new Error(`Unknown option "${option}"`);
  }

  return {
    command: commandValue as CliCommand,
    json,
    ...(network === undefined ? {} : { network }),
    ...(proofServer === undefined ? {} : { proofServer }),
  };
};
