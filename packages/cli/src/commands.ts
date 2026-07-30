import { randomBytes } from 'node:crypto';

import {
  AEQUIRA_PRIVATE_STATE_ID,
  createAequiraPrivateState,
  deployAequira,
  joinAequira,
  type AequiraPrivateState,
} from '@aequira/sdk';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { assertIsContractAddress } from '@midnight-ntwrk/midnight-js-utils';

import { writeRuntimeBackup } from './backup.js';
import type { CliConfig } from './config.js';
import { runDoctor, type DoctorCheck } from './doctor.js';
import { createAequiraRuntime, type AequiraRuntime } from './runtime.js';
import {
  promptHiddenSecret,
  readRuntimeSecrets,
  type RuntimeSecrets,
  type SecretPrompt,
} from './secret-input.js';

const BYTES32_HEX_PATTERN = /^[0-9a-fA-F]{64}$/;

export const parseBytes32 = (name: string, value: string): Uint8Array => {
  if (!BYTES32_HEX_PATTERN.test(value)) {
    throw new Error(`${name} must be exactly 64 hexadecimal characters`);
  }

  return Buffer.from(value, 'hex');
};

const assertDoctorReady = (checks: readonly DoctorCheck[]): void => {
  const failures = checks.filter((check) => !check.ok);

  if (failures.length > 0) {
    throw new Error(
      `Runtime prerequisites failed: ${failures.map((failure) => failure.name).join(', ')}`,
    );
  }
};

const clearPrivateState = (privateState: AequiraPrivateState): void => {
  privateState.adminSecret.fill(0);
  privateState.reviewerSecret.fill(0);
  privateState.scoreSalt.fill(0);
};

const createFreshPrivateState = (): AequiraPrivateState =>
  createAequiraPrivateState(randomBytes(32), randomBytes(32), 0n, randomBytes(32));

export type CommandDependencies = {
  readonly createRuntime?: typeof createAequiraRuntime;
  readonly deployContract?: typeof deployAequira;
  readonly joinContract?: typeof joinAequira;
  readonly promptSecret?: SecretPrompt;
  readonly readSecrets?: (promptSecret?: SecretPrompt) => Promise<RuntimeSecrets>;
  readonly runPrerequisiteChecks?: typeof runDoctor;
  readonly writeBackup?: typeof writeRuntimeBackup;
};

export type DeployCommandResult = {
  readonly backupPath: string;
  readonly contractAddress: ContractAddress;
};

export class DeploymentBackupError extends Error {
  override readonly name = 'DeploymentBackupError';
  readonly contractAddress: ContractAddress;

  constructor(contractAddress: ContractAddress, cause: unknown) {
    super(
      `Contract deployed at ${contractAddress}, but encrypted backup creation failed. Do not deploy again; preserve the private-state directory and repair the backup locally.`,
      { cause },
    );
    this.contractAddress = contractAddress;
  }
}

export const runDeployCommand = async (
  config: CliConfig,
  roundIdHex: string,
  dependencies: CommandDependencies = {},
): Promise<DeployCommandResult> => {
  const roundId = parseBytes32('round ID', roundIdHex);
  const checks = await (dependencies.runPrerequisiteChecks ?? runDoctor)(config);
  assertDoctorReady(checks);
  const promptSecret = dependencies.promptSecret ?? promptHiddenSecret;
  const secrets = await (dependencies.readSecrets ?? readRuntimeSecrets)(promptSecret);
  let privateState: AequiraPrivateState | undefined;
  let runtime: AequiraRuntime | undefined;

  try {
    privateState = createFreshPrivateState();
    runtime = await (dependencies.createRuntime ?? createAequiraRuntime)({
      config,
      privateStatePassword: secrets.privateStatePassword,
      walletSeed: secrets.walletSeed,
    });
    await runtime.wallet.start();
    await runtime.wallet.waitForSync();

    const deployed = await (dependencies.deployContract ?? deployAequira)(runtime.providers, {
      roundId,
      privateState,
    });
    const contractAddress = deployed.deployTxData.public.contractAddress;
    let backupPath: string;

    try {
      backupPath = await (dependencies.writeBackup ?? writeRuntimeBackup)({
        config,
        contractAddress,
        privateStateProvider: runtime.providers.privateStateProvider,
      });
    } catch (error) {
      throw new DeploymentBackupError(contractAddress, error);
    }

    return { contractAddress, backupPath };
  } finally {
    if (privateState !== undefined) {
      clearPrivateState(privateState);
    }

    secrets.walletSeed.fill(0);
    await runtime?.close();
  }
};

export type JoinCommandResult = {
  readonly backupPath: string;
  readonly contractAddress: ContractAddress;
  readonly initializedPrivateState: boolean;
};

export const runJoinCommand = async (
  config: CliConfig,
  contractAddressValue: string,
  dependencies: CommandDependencies = {},
): Promise<JoinCommandResult> => {
  assertIsContractAddress(contractAddressValue);
  const contractAddress = contractAddressValue;
  const checks = await (dependencies.runPrerequisiteChecks ?? runDoctor)(config);
  assertDoctorReady(checks);
  const promptSecret = dependencies.promptSecret ?? promptHiddenSecret;
  const secrets = await (dependencies.readSecrets ?? readRuntimeSecrets)(promptSecret);
  let runtime: AequiraRuntime | undefined;
  let initialPrivateState: AequiraPrivateState | undefined;

  try {
    runtime = await (dependencies.createRuntime ?? createAequiraRuntime)({
      config,
      privateStatePassword: secrets.privateStatePassword,
      walletSeed: secrets.walletSeed,
    });
    await runtime.wallet.start();
    await runtime.wallet.waitForSync();

    runtime.providers.privateStateProvider.setContractAddress(contractAddress);
    const existingPrivateState =
      await runtime.providers.privateStateProvider.get(AEQUIRA_PRIVATE_STATE_ID);
    initialPrivateState = existingPrivateState === null ? createFreshPrivateState() : undefined;
    await (dependencies.joinContract ?? joinAequira)(
      runtime.providers,
      initialPrivateState === undefined
        ? { contractAddress }
        : { contractAddress, initialPrivateState },
    );
    const backupPath = await (dependencies.writeBackup ?? writeRuntimeBackup)({
      config,
      contractAddress,
      privateStateProvider: runtime.providers.privateStateProvider,
    });

    return {
      contractAddress,
      backupPath,
      initializedPrivateState: initialPrivateState !== undefined,
    };
  } finally {
    if (initialPrivateState !== undefined) {
      clearPrivateState(initialPrivateState);
    }

    secrets.walletSeed.fill(0);
    await runtime?.close();
  }
};
