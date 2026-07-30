import type { AequiraNetwork } from './config.js';

export const COMMANDS = [
  'commit-score',
  'config',
  'deploy',
  'doctor',
  'help',
  'join',
  'open-applications',
  'open-reveal',
  'open-review',
  'register-reviewer',
  'restore',
  'reveal-score',
  'wallet-address',
] as const;

export type CliCommand = (typeof COMMANDS)[number];

export type CliArguments = {
  readonly applicationId?: string;
  readonly backupFile?: string;
  readonly command: CliCommand;
  readonly contractAddress?: string;
  readonly json: boolean;
  readonly network?: AequiraNetwork;
  readonly proofServer?: string;
  readonly reviewerId?: string;
  readonly roundId?: string;
};

const SENSITIVE_OPTIONS = new Set([
  '--admin-secret',
  '--mnemonic',
  '--password',
  '--private-key',
  '--reviewer-secret',
  '--score',
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
  let applicationId: string | undefined;
  let backupFile: string | undefined;
  let contractAddress: string | undefined;
  let network: AequiraNetwork | undefined;
  let proofServer: string | undefined;
  let reviewerId: string | undefined;
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

    if (option === '--application-id') {
      applicationId = readOptionValue(options, index, option);
      index += 1;
      continue;
    }

    if (option === '--reviewer-id') {
      reviewerId = readOptionValue(options, index, option);
      index += 1;
      continue;
    }

    if (option === '--backup-file') {
      backupFile = readOptionValue(options, index, option);
      index += 1;
      continue;
    }

    throw new Error(`Unknown option "${option}"`);
  }

  const requiresContractAddress =
    commandValue === 'commit-score' ||
    commandValue === 'join' ||
    commandValue === 'open-applications' ||
    commandValue === 'open-reveal' ||
    commandValue === 'open-review' ||
    commandValue === 'register-reviewer' ||
    commandValue === 'reveal-score';
  const requiresApplicationId = commandValue === 'commit-score' || commandValue === 'reveal-score';

  if (commandValue === 'deploy' && roundId === undefined) {
    throw new Error('deploy requires --round-id');
  }

  if (commandValue !== 'deploy' && roundId !== undefined) {
    throw new Error('--round-id is only valid with deploy');
  }

  if (requiresContractAddress && contractAddress === undefined) {
    throw new Error(`${commandValue} requires --contract-address`);
  }

  if (!requiresContractAddress && contractAddress !== undefined) {
    throw new Error('--contract-address is only valid with a deployed-contract command');
  }

  if (requiresApplicationId && applicationId === undefined) {
    throw new Error(`${commandValue} requires --application-id`);
  }

  if (!requiresApplicationId && applicationId !== undefined) {
    throw new Error('--application-id is only valid with commit-score or reveal-score');
  }

  if (commandValue === 'register-reviewer' && reviewerId === undefined) {
    throw new Error('register-reviewer requires --reviewer-id');
  }

  if (commandValue !== 'register-reviewer' && reviewerId !== undefined) {
    throw new Error('--reviewer-id is only valid with register-reviewer');
  }

  if (commandValue === 'restore' && backupFile === undefined) {
    throw new Error('restore requires --backup-file');
  }

  if (commandValue !== 'restore' && backupFile !== undefined) {
    throw new Error('--backup-file is only valid with restore');
  }

  return {
    command: commandValue as CliCommand,
    json,
    ...(applicationId === undefined ? {} : { applicationId }),
    ...(backupFile === undefined ? {} : { backupFile }),
    ...(contractAddress === undefined ? {} : { contractAddress }),
    ...(network === undefined ? {} : { network }),
    ...(proofServer === undefined ? {} : { proofServer }),
    ...(reviewerId === undefined ? {} : { reviewerId }),
    ...(roundId === undefined ? {} : { roundId }),
  };
};
