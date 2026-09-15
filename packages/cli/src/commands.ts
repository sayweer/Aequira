import { randomBytes } from 'node:crypto';

import {
  AEQUIRA_PRIVATE_STATE_ID,
  createAequiraPrivateState,
  deployAequira,
  deriveApplicantId,
  deriveApplicantLeaf,
  deriveApplicationNonce,
  deriveReviewerId,
  deriveScoreSalt,
  joinAequira,
  readRoundId,
  setAequiraPrivateState,
  validateAequiraPrivateState,
  type AequiraPrivateState,
  type FoundAequiraContract,
} from '@aequira/sdk';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { FinalizedTxData } from '@midnight-ntwrk/midnight-js-types';
import { assertIsContractAddress, validatePassword } from '@midnight-ntwrk/midnight-js-utils';
import { generateRandomSeed } from '@midnight-ntwrk/wallet-sdk';

import {
  readRuntimeBackup,
  verifyRuntimeBackupAuthentication,
  writeRuntimeBackup,
} from './backup.js';
import type { CliConfig } from './config.js';
import { runDoctor, type DoctorCheck } from './doctor.js';
import { createAequiraRuntime, type AequiraRuntime } from './runtime.js';
import {
  promptHiddenSecret,
  readRuntimeSecrets,
  readWalletSeed,
  type RuntimeSecrets,
  type SecretPrompt,
} from './secret-input.js';
import {
  AequiraWalletProvider,
  deriveUnshieldedAddress,
  parseDustAddress,
} from './wallet-provider.js';
import { writeWalletVault } from './wallet-vault.js';

const BYTES32_HEX_PATTERN = /^[0-9a-fA-F]{64}$/;
const SCORE_PATTERN = /^(?:0|[1-9][0-9]{0,2})$/;

export const parseBytes32 = (name: string, value: string): Uint8Array => {
  if (!BYTES32_HEX_PATTERN.test(value)) {
    throw new Error(`${name} must be exactly 64 hexadecimal characters`);
  }

  return Buffer.from(value, 'hex');
};

export const parseScore = (value: string): bigint => {
  if (!SCORE_PATTERN.test(value)) {
    throw new Error('Score must be a whole number between 0 and 100');
  }

  const score = BigInt(value);

  if (score > 100n) {
    throw new Error('Score must be a whole number between 0 and 100');
  }

  return score;
};

/**
 * Parses one of the round's published eligibility thresholds. The maximum is
 * the width of the matching ledger field, so a value the contract could not
 * store is refused before a wallet is opened.
 */
export const parseThreshold = (name: string, value: string, maximum: bigint): bigint => {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${name} must be a whole number between 0 and ${maximum}`);
  }

  const parsed = BigInt(value);

  if (parsed > maximum) {
    throw new Error(`${name} must be a whole number between 0 and ${maximum}`);
  }

  return parsed;
};

export const parseContractAddress = (value: string): ContractAddress => {
  try {
    assertIsContractAddress(value);
    return value;
  } catch {
    throw new Error('Contract address is invalid');
  }
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
  privateState.applicantSecret.fill(0);
  privateState.applicantSalt.fill(0);
};

const assertWalletHasDust = async (wallet: AequiraWalletProvider): Promise<void> => {
  const fundingState = await wallet.waitForFundingState();

  if (fundingState.dustBalance <= 0n) {
    throw new Error(
      'Wallet has no Dust for transaction fees; fund NIGHT, run register-dust, then confirm funding-status before retrying',
    );
  }
};

const createFreshPrivateState = (): AequiraPrivateState =>
  createAequiraPrivateState({
    adminSecret: randomBytes(32),
    reviewerSecret: randomBytes(32),
    score: 0n,
    scoreSalt: randomBytes(32),
    applicantSecret: randomBytes(32),
    applicantIncomeBand: 0n,
    applicantGpaScaled: 0n,
    applicantRegionCode: 0n,
    applicantSalt: randomBytes(32),
  });

export type CommandDependencies = {
  readonly createWalletProvider?: typeof AequiraWalletProvider.create;
  readonly createRuntime?: typeof createAequiraRuntime;
  readonly deriveWalletAddress?: typeof deriveUnshieldedAddress;
  readonly deployContract?: typeof deployAequira;
  readonly generateWalletSeed?: typeof generateRandomSeed;
  readonly joinContract?: typeof joinAequira;
  readonly promptSecret?: SecretPrompt;
  readonly readBackup?: typeof readRuntimeBackup;
  readonly readRoundId?: typeof readRoundId;
  readonly readSecrets?: (
    config: CliConfig,
    promptSecret?: SecretPrompt,
  ) => Promise<RuntimeSecrets>;
  readonly readWalletSeed?: (config: CliConfig, promptSecret?: SecretPrompt) => Promise<Uint8Array>;
  readonly runPrerequisiteChecks?: typeof runDoctor;
  readonly verifyBackup?: typeof verifyRuntimeBackupAuthentication;
  readonly writeBackup?: typeof writeRuntimeBackup;
  readonly writeWalletVault?: typeof writeWalletVault;
};

export type TransactionCommandResult = {
  readonly backupPath: string;
  readonly blockHeight: number;
  readonly contractAddress: ContractAddress;
  readonly transactionHash: string;
  readonly transactionId: string;
};

export type DeployCommandResult = {
  readonly backupPath: string;
  readonly contractAddress: ContractAddress;
};

export type AequiraCallName =
  | 'apply'
  | 'commitScore'
  | 'openApplications'
  | 'openReveal'
  | 'openReview'
  | 'registerApplicant'
  | 'registerReviewer'
  | 'revealScore';

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

export class EnrollmentBackupError extends Error {
  override readonly name = 'EnrollmentBackupError';
  readonly contractAddress: ContractAddress;

  constructor(contractAddress: ContractAddress, cause: unknown) {
    super(
      `Enrollment attributes were saved locally for ${contractAddress}, but encrypted backup creation failed. Preserve the private-state directory and repair the backup before re-enrolling with different attributes — losing this local store would permanently orphan whatever leaf the institution already registered.`,
      { cause },
    );
    this.contractAddress = contractAddress;
  }
}

export class FinalizedCallBackupError extends Error {
  override readonly name = 'FinalizedCallBackupError';
  readonly contractAddress: ContractAddress;
  readonly transactionId: string;

  constructor(
    contractAddress: ContractAddress,
    transactionId: string,
    circuit: AequiraCallName,
    cause: unknown,
  ) {
    super(
      `${circuit} transaction ${transactionId} finalized for ${contractAddress}, but encrypted backup creation failed. Do not submit the call again; preserve the private-state directory and repair the backup locally.`,
      { cause },
    );
    this.contractAddress = contractAddress;
    this.transactionId = transactionId;
  }
}

export class DustRegistrationCleanupError extends Error {
  override readonly name = 'DustRegistrationCleanupError';
  readonly transactionId: string;

  constructor(transactionId: string, cause: unknown) {
    super(
      `Dust registration transaction ${transactionId} was submitted, but wallet cleanup failed. Do not submit the registration again until funding-status confirms the network state.`,
      { cause },
    );
    this.transactionId = transactionId;
  }
}

const toTransactionCommandResult = (
  contractAddress: ContractAddress,
  transaction: FinalizedTxData,
  backupPath: string,
): TransactionCommandResult => ({
  contractAddress,
  transactionId: transaction.txId,
  transactionHash: transaction.txHash,
  blockHeight: transaction.blockHeight,
  backupPath,
});

const writeFinalizedCallBackup = async (
  authenticationPassword: string,
  config: CliConfig,
  contractAddress: ContractAddress,
  circuit: AequiraCallName,
  transaction: FinalizedTxData,
  runtime: AequiraRuntime,
  writeBackup: typeof writeRuntimeBackup,
): Promise<string> => {
  try {
    return await writeBackup({
      authenticationPassword,
      config,
      contractAddress,
      privateStateProvider: runtime.providers.privateStateProvider,
    });
  } catch (error) {
    throw new FinalizedCallBackupError(contractAddress, transaction.txId, circuit, error);
  }
};

export const runDeployCommand = async (
  config: CliConfig,
  roundIdHex: string,
  maxIncomeBandValue: string,
  minGpaScaledValue: string,
  dependencies: CommandDependencies = {},
): Promise<DeployCommandResult> => {
  const roundId = parseBytes32('round ID', roundIdHex);
  const maxIncomeBand = parseThreshold('Maximum income band', maxIncomeBandValue, 255n);
  const minGpaScaled = parseThreshold('Minimum scaled grade average', minGpaScaledValue, 65535n);
  const checks = await (dependencies.runPrerequisiteChecks ?? runDoctor)(config);
  assertDoctorReady(checks);
  const promptSecret = dependencies.promptSecret ?? promptHiddenSecret;
  const secrets = await (dependencies.readSecrets ?? readRuntimeSecrets)(config, promptSecret);
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
    await assertWalletHasDust(runtime.wallet);

    const deployed = await (dependencies.deployContract ?? deployAequira)(runtime.providers, {
      roundId,
      privateState,
      maxIncomeBand,
      minGpaScaled,
    });
    const contractAddress = deployed.deployTxData.public.contractAddress;
    let backupPath: string;

    try {
      backupPath = await (dependencies.writeBackup ?? writeRuntimeBackup)({
        authenticationPassword: secrets.privateStatePassword,
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
  readonly reviewerId: string;
};

export type RestoreCommandResult = {
  readonly contractAddress: ContractAddress;
  readonly restoredPrivateStates: number;
  readonly restoredSigningKeys: number;
  readonly reviewerId: string;
};

export type WalletAddressCommandResult = {
  readonly network: CliConfig['network'];
  readonly unshieldedAddress: string;
};

export type WalletCreateCommandResult = WalletAddressCommandResult & {
  readonly vaultPath: string;
};

export type FundingStatusCommandResult = {
  readonly dustBalance: string;
  readonly hasDust: boolean;
  readonly network: CliConfig['network'];
  readonly nightBalance: string;
  readonly unshieldedAddress: string;
};

export type RegisterDustCommandResult = {
  readonly dustBalanceBefore: string;
  /** The wallet receiving the generated Dust, or `null` when it is this wallet itself. */
  readonly dustReceiverAddress: string | null;
  readonly network: CliConfig['network'];
  readonly registeredUtxos: number;
  readonly submitted: boolean;
  readonly transactionId: string | null;
  readonly unshieldedAddress: string;
};

export const runWalletCreateCommand = async (
  config: CliConfig,
  dependencies: CommandDependencies = {},
): Promise<WalletCreateCommandResult> => {
  const promptSecret = dependencies.promptSecret ?? promptHiddenSecret;
  const password = await promptSecret('New development-wallet password: ');
  validatePassword(password);
  const confirmation = await promptSecret('Confirm development-wallet password: ');

  if (confirmation !== password) {
    throw new Error('Development-wallet passwords do not match');
  }

  const walletSeed = (dependencies.generateWalletSeed ?? generateRandomSeed)();

  if (walletSeed.byteLength !== 32) {
    walletSeed.fill(0);
    throw new Error('Wallet SDK generated an invalid seed');
  }

  const addressSeed = Uint8Array.from(walletSeed);

  try {
    const unshieldedAddress = (dependencies.deriveWalletAddress ?? deriveUnshieldedAddress)(
      config,
      addressSeed,
    );
    const vaultPath = await (dependencies.writeWalletVault ?? writeWalletVault)({
      config,
      password,
      seed: walletSeed,
    });

    return {
      network: config.network,
      unshieldedAddress,
      vaultPath,
    };
  } finally {
    addressSeed.fill(0);
    walletSeed.fill(0);
  }
};

export const runWalletAddressCommand = async (
  config: CliConfig,
  dependencies: CommandDependencies = {},
): Promise<WalletAddressCommandResult> => {
  const promptSecret = dependencies.promptSecret ?? promptHiddenSecret;
  const walletSeed = await (dependencies.readWalletSeed ?? readWalletSeed)(config, promptSecret);

  try {
    const unshieldedAddress = (dependencies.deriveWalletAddress ?? deriveUnshieldedAddress)(
      config,
      walletSeed,
    );

    return {
      network: config.network,
      unshieldedAddress,
    };
  } finally {
    walletSeed.fill(0);
  }
};

export const runFundingStatusCommand = async (
  config: CliConfig,
  dependencies: CommandDependencies = {},
): Promise<FundingStatusCommandResult> => {
  const promptSecret = dependencies.promptSecret ?? promptHiddenSecret;
  const walletSeed = await (dependencies.readWalletSeed ?? readWalletSeed)(config, promptSecret);
  let wallet: AequiraWalletProvider | undefined;

  try {
    wallet = await (dependencies.createWalletProvider ?? AequiraWalletProvider.create)(
      config,
      walletSeed,
    );
    await wallet.start();
    const fundingState = await wallet.waitForFundingState();

    return {
      dustBalance: fundingState.dustBalance.toString(),
      hasDust: fundingState.dustBalance > 0n,
      network: config.network,
      nightBalance: fundingState.nightBalance.toString(),
      unshieldedAddress: wallet.accountId,
    };
  } finally {
    walletSeed.fill(0);
    await wallet?.stop();
  }
};

export const runRegisterDustCommand = async (
  config: CliConfig,
  dustAddressValue: string | undefined,
  dependencies: CommandDependencies = {},
): Promise<RegisterDustCommandResult> => {
  const dustReceiverAddress =
    dustAddressValue === undefined
      ? undefined
      : parseDustAddress(dustAddressValue, config.walletNetworkId);
  const promptSecret = dependencies.promptSecret ?? promptHiddenSecret;
  const walletSeed = await (dependencies.readWalletSeed ?? readWalletSeed)(config, promptSecret);
  let wallet: AequiraWalletProvider | undefined;
  let submittedTransactionId: string | undefined;

  try {
    wallet = await (dependencies.createWalletProvider ?? AequiraWalletProvider.create)(
      config,
      walletSeed,
    );
    await wallet.start();
    const registration = await wallet.registerAvailableNightForDust(dustReceiverAddress);
    submittedTransactionId = registration.transactionId ?? undefined;

    return {
      dustBalanceBefore: registration.dustBalanceBefore.toString(),
      dustReceiverAddress: dustAddressValue ?? null,
      network: config.network,
      registeredUtxos: registration.registeredUtxos,
      submitted: registration.transactionId !== null,
      transactionId: registration.transactionId,
      unshieldedAddress: wallet.accountId,
    };
  } finally {
    walletSeed.fill(0);

    try {
      await wallet?.stop();
    } catch (error) {
      if (submittedTransactionId !== undefined) {
        throw new DustRegistrationCleanupError(submittedTransactionId, error);
      }
      throw error;
    }
  }
};

export const runJoinCommand = async (
  config: CliConfig,
  contractAddressValue: string,
  dependencies: CommandDependencies = {},
): Promise<JoinCommandResult> => {
  const contractAddress = parseContractAddress(contractAddressValue);
  const checks = await (dependencies.runPrerequisiteChecks ?? runDoctor)(config);
  assertDoctorReady(checks);
  const promptSecret = dependencies.promptSecret ?? promptHiddenSecret;
  const secrets = await (dependencies.readSecrets ?? readRuntimeSecrets)(config, promptSecret);
  let existingPrivateState: AequiraPrivateState | undefined;
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
    const storedPrivateState =
      await runtime.providers.privateStateProvider.get(AEQUIRA_PRIVATE_STATE_ID);
    existingPrivateState = storedPrivateState ?? undefined;
    initialPrivateState = storedPrivateState === null ? createFreshPrivateState() : undefined;
    const activePrivateState = existingPrivateState ?? initialPrivateState;

    if (activePrivateState === undefined) {
      throw new Error('Unable to initialize local private state');
    }

    validateAequiraPrivateState(activePrivateState);
    await (dependencies.joinContract ?? joinAequira)(
      runtime.providers,
      initialPrivateState === undefined
        ? { contractAddress }
        : { contractAddress, initialPrivateState },
    );
    const backupPath = await (dependencies.writeBackup ?? writeRuntimeBackup)({
      authenticationPassword: secrets.privateStatePassword,
      config,
      contractAddress,
      privateStateProvider: runtime.providers.privateStateProvider,
    });

    return {
      contractAddress,
      backupPath,
      initializedPrivateState: initialPrivateState !== undefined,
      reviewerId: Buffer.from(deriveReviewerId(activePrivateState.reviewerSecret)).toString('hex'),
    };
  } finally {
    if (existingPrivateState !== undefined) {
      clearPrivateState(existingPrivateState);
    }
    if (initialPrivateState !== undefined) {
      clearPrivateState(initialPrivateState);
    }

    secrets.walletSeed.fill(0);
    await runtime?.close();
  }
};

export const runRestoreCommand = async (
  config: CliConfig,
  backupPath: string,
  dependencies: CommandDependencies = {},
): Promise<RestoreCommandResult> => {
  const backup = await (dependencies.readBackup ?? readRuntimeBackup)(backupPath);

  if (backup.network !== config.network) {
    throw new Error(
      `Backup network ${backup.network} does not match configured network ${config.network}`,
    );
  }

  const promptSecret = dependencies.promptSecret ?? promptHiddenSecret;
  const secrets = await (dependencies.readSecrets ?? readRuntimeSecrets)(config, promptSecret);
  let restoredPrivateState: AequiraPrivateState | undefined;
  let runtime: AequiraRuntime | undefined;

  try {
    await (dependencies.verifyBackup ?? verifyRuntimeBackupAuthentication)(
      backup,
      secrets.privateStatePassword,
    );
    runtime = await (dependencies.createRuntime ?? createAequiraRuntime)({
      config,
      privateStatePassword: secrets.privateStatePassword,
      walletSeed: secrets.walletSeed,
    });
    const provider = runtime.providers.privateStateProvider;
    provider.setContractAddress(backup.contractAddress);
    const existingPrivateState = await provider.get(AEQUIRA_PRIVATE_STATE_ID);
    const existingSigningKey = await provider.getSigningKey(backup.contractAddress);

    if (existingPrivateState !== null || existingSigningKey !== null) {
      if (existingPrivateState !== null) {
        clearPrivateState(existingPrivateState);
      }
      throw new Error(
        'Restore target already contains contract state or a signing key; refusing to overwrite',
      );
    }

    const signingKeyResult = await provider.importSigningKeys(backup.signingKeys, {
      conflictStrategy: 'error',
      maxKeys: 100,
    });
    const privateStateResult = await provider.importPrivateStates(backup.privateStates, {
      conflictStrategy: 'error',
      maxStates: 100,
    });
    const importedPrivateState = await provider.get(AEQUIRA_PRIVATE_STATE_ID);
    const restoredSigningKey = await provider.getSigningKey(backup.contractAddress);

    if (importedPrivateState === null || restoredSigningKey === null) {
      throw new Error('Backup did not restore the required AEQUIRA state and signing key');
    }

    restoredPrivateState = importedPrivateState;
    validateAequiraPrivateState(importedPrivateState);

    return {
      contractAddress: backup.contractAddress,
      restoredPrivateStates: privateStateResult.imported,
      restoredSigningKeys: signingKeyResult.imported,
      reviewerId: Buffer.from(deriveReviewerId(importedPrivateState.reviewerSecret)).toString(
        'hex',
      ),
    };
  } finally {
    if (restoredPrivateState !== undefined) {
      clearPrivateState(restoredPrivateState);
    }

    secrets.walletSeed.fill(0);
    await runtime?.close();
  }
};

const readExistingPrivateState = async (
  runtime: AequiraRuntime,
  contractAddress: ContractAddress,
): Promise<AequiraPrivateState> => {
  runtime.providers.privateStateProvider.setContractAddress(contractAddress);
  const privateState = await runtime.providers.privateStateProvider.get(AEQUIRA_PRIVATE_STATE_ID);

  if (privateState === null) {
    throw new Error(
      `No local private state exists for ${contractAddress}; run join before submitting a contract call`,
    );
  }

  validateAequiraPrivateState(privateState);
  return privateState;
};

const joinForCall = async (
  runtime: AequiraRuntime,
  contractAddress: ContractAddress,
  joinContract: typeof joinAequira,
): Promise<FoundAequiraContract> =>
  joinContract(runtime.providers, {
    contractAddress,
  });

type SubmitContractCall = (
  contract: FoundAequiraContract,
) => Promise<{ readonly public: FinalizedTxData }>;

const runExistingPrivateStateCall = async (
  config: CliConfig,
  contractAddress: ContractAddress,
  circuit: AequiraCallName,
  submitCall: SubmitContractCall,
  dependencies: CommandDependencies,
): Promise<TransactionCommandResult> => {
  const checks = await (dependencies.runPrerequisiteChecks ?? runDoctor)(config);
  assertDoctorReady(checks);
  const promptSecret = dependencies.promptSecret ?? promptHiddenSecret;
  const secrets = await (dependencies.readSecrets ?? readRuntimeSecrets)(config, promptSecret);
  let currentPrivateState: AequiraPrivateState | undefined;
  let runtime: AequiraRuntime | undefined;

  try {
    runtime = await (dependencies.createRuntime ?? createAequiraRuntime)({
      config,
      privateStatePassword: secrets.privateStatePassword,
      walletSeed: secrets.walletSeed,
    });
    await runtime.wallet.start();
    await assertWalletHasDust(runtime.wallet);

    const contract = await joinForCall(
      runtime,
      contractAddress,
      dependencies.joinContract ?? joinAequira,
    );
    currentPrivateState = await readExistingPrivateState(runtime, contractAddress);
    const txData = await submitCall(contract);
    const backupPath = await writeFinalizedCallBackup(
      secrets.privateStatePassword,
      config,
      contractAddress,
      circuit,
      txData.public,
      runtime,
      dependencies.writeBackup ?? writeRuntimeBackup,
    );

    return toTransactionCommandResult(contractAddress, txData.public, backupPath);
  } finally {
    if (currentPrivateState !== undefined) {
      clearPrivateState(currentPrivateState);
    }

    secrets.walletSeed.fill(0);
    await runtime?.close();
  }
};

/**
 * Rebuilds the opening for a score before submitting `commitScore` or
 * `revealScore`.
 *
 * `AequiraPrivateState` holds exactly one `scoreSalt`, and `revealScore` must
 * reproduce the same `(score, salt)` pair that produced the on-chain
 * commitment. Deriving the salt from `(roundId, applicationId,
 * reviewerSecret)` via `deriveScoreSalt`, and re-prompting for the score on
 * every call, means each application gets its own opening regardless of what
 * was committed or revealed for a different application in between — a fixed
 * random salt per commit would instead silently strand the reveal of any
 * previously scored application. See `packages/ui/src/round.ts`'s
 * `buildOpening`, which follows the same pattern.
 */
const runScoreOpeningCall = async (
  config: CliConfig,
  contractAddress: ContractAddress,
  applicationId: Uint8Array,
  circuit: AequiraCallName,
  scorePrompt: string,
  submitCall: SubmitContractCall,
  dependencies: CommandDependencies,
): Promise<TransactionCommandResult> => {
  const checks = await (dependencies.runPrerequisiteChecks ?? runDoctor)(config);
  assertDoctorReady(checks);
  const promptSecret = dependencies.promptSecret ?? promptHiddenSecret;
  const secrets = await (dependencies.readSecrets ?? readRuntimeSecrets)(config, promptSecret);
  let currentPrivateState: AequiraPrivateState | undefined;
  let nextPrivateState: AequiraPrivateState | undefined;
  let runtime: AequiraRuntime | undefined;

  try {
    const score = parseScore(await promptSecret(scorePrompt));
    runtime = await (dependencies.createRuntime ?? createAequiraRuntime)({
      config,
      privateStatePassword: secrets.privateStatePassword,
      walletSeed: secrets.walletSeed,
    });
    await runtime.wallet.start();
    await assertWalletHasDust(runtime.wallet);

    const contract = await joinForCall(
      runtime,
      contractAddress,
      dependencies.joinContract ?? joinAequira,
    );
    currentPrivateState = await readExistingPrivateState(runtime, contractAddress);
    const reviewerSecret = Uint8Array.from(currentPrivateState.reviewerSecret);
    const roundId = await (dependencies.readRoundId ?? readRoundId)(
      runtime.providers,
      contractAddress,
    );
    const scoreSalt = await deriveScoreSalt(roundId, applicationId, reviewerSecret);
    nextPrivateState = createAequiraPrivateState({
      ...currentPrivateState,
      reviewerSecret,
      score,
      scoreSalt,
    });
    await setAequiraPrivateState(runtime.providers, contractAddress, nextPrivateState);

    const txData = await submitCall(contract);
    const backupPath = await writeFinalizedCallBackup(
      secrets.privateStatePassword,
      config,
      contractAddress,
      circuit,
      txData.public,
      runtime,
      dependencies.writeBackup ?? writeRuntimeBackup,
    );

    return toTransactionCommandResult(contractAddress, txData.public, backupPath);
  } finally {
    if (currentPrivateState !== undefined) {
      clearPrivateState(currentPrivateState);
    }
    if (nextPrivateState !== undefined) {
      clearPrivateState(nextPrivateState);
    }

    secrets.walletSeed.fill(0);
    await runtime?.close();
  }
};

export const runCommitScoreCommand = async (
  config: CliConfig,
  contractAddressValue: string,
  applicationIdHex: string,
  dependencies: CommandDependencies = {},
): Promise<TransactionCommandResult> => {
  const contractAddress = parseContractAddress(contractAddressValue);
  const applicationId = parseBytes32('application ID', applicationIdHex);
  return runScoreOpeningCall(
    config,
    contractAddress,
    applicationId,
    'commitScore',
    'Review score (0-100): ',
    (contract) => contract.callTx.commitScore(applicationId),
    dependencies,
  );
};

export const runRevealScoreCommand = async (
  config: CliConfig,
  contractAddressValue: string,
  applicationIdHex: string,
  dependencies: CommandDependencies = {},
): Promise<TransactionCommandResult> => {
  const contractAddress = parseContractAddress(contractAddressValue);
  const applicationId = parseBytes32('application ID', applicationIdHex);
  return runScoreOpeningCall(
    config,
    contractAddress,
    applicationId,
    'revealScore',
    'Score to reveal (0-100): ',
    (contract) => contract.callTx.revealScore(applicationId),
    dependencies,
  );
};

export const runRegisterReviewerCommand = async (
  config: CliConfig,
  contractAddressValue: string,
  reviewerIdHex: string,
  dependencies: CommandDependencies = {},
): Promise<TransactionCommandResult> => {
  const contractAddress = parseContractAddress(contractAddressValue);
  const reviewerId = parseBytes32('reviewer ID', reviewerIdHex);

  return runExistingPrivateStateCall(
    config,
    contractAddress,
    'registerReviewer',
    (contract) => contract.callTx.registerReviewer(reviewerId),
    dependencies,
  );
};

export const runRegisterApplicantCommand = async (
  config: CliConfig,
  contractAddressValue: string,
  enrollmentLeafHex: string,
  dependencies: CommandDependencies = {},
): Promise<TransactionCommandResult> => {
  const contractAddress = parseContractAddress(contractAddressValue);
  const enrollmentLeaf = parseBytes32('enrollment leaf', enrollmentLeafHex);

  return runExistingPrivateStateCall(
    config,
    contractAddress,
    'registerApplicant',
    (contract) => contract.callTx.registerApplicant(enrollmentLeaf),
    dependencies,
  );
};

export type EnrollApplicantCommandResult = {
  readonly applicantId: string;
  readonly backupPath: string;
  readonly contractAddress: ContractAddress;
  readonly enrollmentLeaf: string;
};

/**
 * Computes the enrollment leaf locally, the same way `apply`'s own witness
 * later recomputes it, and never sends the applicant's attributes or secret
 * anywhere. The institution only ever receives the resulting `enrollmentLeaf`
 * to pass to `register-applicant` — see `deriveApplicantLeaf` in
 * `@aequira/sdk` for why there is no alternative path that builds the same
 * leaf from an ID instead of the raw attributes and secret.
 *
 * Requires local private state to already exist for this contract (run `join`
 * first): enrollment reuses the `applicantSecret` and `applicantSalt` that
 * `join` already drew at random, rather than generating new ones, so this
 * command can be re-run safely if the attributes were entered incorrectly —
 * the same secret and salt keep working the next time `apply` needs them.
 */
export const runEnrollApplicantCommand = async (
  config: CliConfig,
  contractAddressValue: string,
  attributePrompts: {
    readonly gpaScaledPrompt: string;
    readonly incomeBandPrompt: string;
    readonly regionCodePrompt: string;
  },
  dependencies: CommandDependencies = {},
): Promise<EnrollApplicantCommandResult> => {
  const contractAddress = parseContractAddress(contractAddressValue);
  const checks = await (dependencies.runPrerequisiteChecks ?? runDoctor)(config);
  assertDoctorReady(checks);
  const promptSecret = dependencies.promptSecret ?? promptHiddenSecret;
  const secrets = await (dependencies.readSecrets ?? readRuntimeSecrets)(config, promptSecret);
  let currentPrivateState: AequiraPrivateState | undefined;
  let nextPrivateState: AequiraPrivateState | undefined;
  let runtime: AequiraRuntime | undefined;

  try {
    const incomeBand = parseThreshold(
      'Income band',
      await promptSecret(attributePrompts.incomeBandPrompt),
      255n,
    );
    const gpaScaled = parseThreshold(
      'Scaled grade average',
      await promptSecret(attributePrompts.gpaScaledPrompt),
      65535n,
    );
    const regionCode = parseThreshold(
      'Region code',
      await promptSecret(attributePrompts.regionCodePrompt),
      255n,
    );
    runtime = await (dependencies.createRuntime ?? createAequiraRuntime)({
      config,
      privateStatePassword: secrets.privateStatePassword,
      walletSeed: secrets.walletSeed,
    });
    await runtime.wallet.start();
    currentPrivateState = await readExistingPrivateState(runtime, contractAddress);
    const applicantSecret = Uint8Array.from(currentPrivateState.applicantSecret);
    const applicantSalt = Uint8Array.from(currentPrivateState.applicantSalt);
    nextPrivateState = createAequiraPrivateState({
      ...currentPrivateState,
      applicantSecret,
      applicantSalt,
      applicantIncomeBand: incomeBand,
      applicantGpaScaled: gpaScaled,
      applicantRegionCode: regionCode,
    });
    await setAequiraPrivateState(runtime.providers, contractAddress, nextPrivateState);

    let backupPath: string;

    try {
      backupPath = await (dependencies.writeBackup ?? writeRuntimeBackup)({
        authenticationPassword: secrets.privateStatePassword,
        config,
        contractAddress,
        privateStateProvider: runtime.providers.privateStateProvider,
      });
    } catch (error) {
      throw new EnrollmentBackupError(contractAddress, error);
    }

    return {
      applicantId: Buffer.from(deriveApplicantId(applicantSecret)).toString('hex'),
      backupPath,
      contractAddress,
      enrollmentLeaf: Buffer.from(
        deriveApplicantLeaf(incomeBand, gpaScaled, regionCode, applicantSecret, applicantSalt),
      ).toString('hex'),
    };
  } finally {
    if (currentPrivateState !== undefined) {
      clearPrivateState(currentPrivateState);
    }
    if (nextPrivateState !== undefined) {
      clearPrivateState(nextPrivateState);
    }

    secrets.walletSeed.fill(0);
    await runtime?.close();
  }
};

/**
 * Submits the applicant's own application.
 *
 * The commitment randomness (`nonce`) is derived from `(roundId,
 * applicantSecret)` rather than drawn at random, so a future `claim` circuit
 * can reproduce the same `applicationPseudonym` without this CLI having to
 * persist a new private-state field for it — see `deriveApplicationNonce` in
 * `@aequira/sdk`.
 */
export const runApplyCommand = async (
  config: CliConfig,
  contractAddressValue: string,
  dependencies: CommandDependencies = {},
): Promise<TransactionCommandResult> => {
  const contractAddress = parseContractAddress(contractAddressValue);
  const checks = await (dependencies.runPrerequisiteChecks ?? runDoctor)(config);
  assertDoctorReady(checks);
  const promptSecret = dependencies.promptSecret ?? promptHiddenSecret;
  const secrets = await (dependencies.readSecrets ?? readRuntimeSecrets)(config, promptSecret);
  let currentPrivateState: AequiraPrivateState | undefined;
  let runtime: AequiraRuntime | undefined;

  try {
    runtime = await (dependencies.createRuntime ?? createAequiraRuntime)({
      config,
      privateStatePassword: secrets.privateStatePassword,
      walletSeed: secrets.walletSeed,
    });
    await runtime.wallet.start();
    await assertWalletHasDust(runtime.wallet);

    const contract = await joinForCall(
      runtime,
      contractAddress,
      dependencies.joinContract ?? joinAequira,
    );
    currentPrivateState = await readExistingPrivateState(runtime, contractAddress);
    const applicantSecret = Uint8Array.from(currentPrivateState.applicantSecret);
    const roundId = await (dependencies.readRoundId ?? readRoundId)(
      runtime.providers,
      contractAddress,
    );
    const nonce = await deriveApplicationNonce(roundId, applicantSecret);
    const txData = await contract.callTx.apply(nonce);
    const backupPath = await writeFinalizedCallBackup(
      secrets.privateStatePassword,
      config,
      contractAddress,
      'apply',
      txData.public,
      runtime,
      dependencies.writeBackup ?? writeRuntimeBackup,
    );

    return toTransactionCommandResult(contractAddress, txData.public, backupPath);
  } finally {
    if (currentPrivateState !== undefined) {
      clearPrivateState(currentPrivateState);
    }

    secrets.walletSeed.fill(0);
    await runtime?.close();
  }
};

export type PhaseCommand = 'open-applications' | 'open-reveal' | 'open-review';

export const runPhaseCommand = async (
  config: CliConfig,
  contractAddressValue: string,
  command: PhaseCommand,
  dependencies: CommandDependencies = {},
): Promise<TransactionCommandResult> => {
  const contractAddress = parseContractAddress(contractAddressValue);

  if (command === 'open-applications') {
    return runExistingPrivateStateCall(
      config,
      contractAddress,
      'openApplications',
      (contract) => contract.callTx.openApplications(),
      dependencies,
    );
  }

  if (command === 'open-review') {
    return runExistingPrivateStateCall(
      config,
      contractAddress,
      'openReview',
      (contract) => contract.callTx.openReview(),
      dependencies,
    );
  }

  if (command === 'open-reveal') {
    return runExistingPrivateStateCall(
      config,
      contractAddress,
      'openReveal',
      (contract) => contract.callTx.openReveal(),
      dependencies,
    );
  }

  throw new Error('Unsupported phase command');
};
