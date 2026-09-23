import { randomBytes } from 'node:crypto';

import {
  AEQUIRA_PRIVATE_STATE_ID,
  Phase,
  createAequiraPrivateState,
  deployAequira,
  deriveApplicantId,
  deriveApplicationNonce,
  deriveApplicationPseudonym,
  deriveApplyNullifier,
  deriveReviewerId,
  deriveScoreCommitment,
  deriveScoreNullifier,
  deriveScoreSalt,
  hasImportedEnrollment,
  issueEnrollmentReceipt,
  joinAequira,
  openEnrollmentReceipt,
  queryAequiraLedger,
  setAequiraPrivateState,
  validateAequiraPrivateState,
  type AequiraLedger,
  type AequiraPrivateState,
  type AequiraProviders,
  type FoundAequiraContract,
} from '@aequira/sdk';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
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

const CLEANUP_WARNING =
  'The wallet connection or private-state store did not close cleanly. The command outcome above is unaffected; restart the CLI before running another command.';

/**
 * Closes the runtime without letting a close failure replace the command's
 * real outcome — by then a transaction may be final or a backup written, and
 * reporting failure could lead to a duplicate submission.
 */
const closeRuntime = async (
  runtime: AequiraRuntime | undefined,
  dependencies: CommandDependencies,
): Promise<void> => {
  try {
    await runtime?.close();
  } catch {
    (dependencies.reportCleanupWarning ?? ((message: string) => process.emitWarning(message)))(
      CLEANUP_WARNING,
    );
  }
};

// The applicant attributes and salt stay zero until the institution's
// enrollment receipt is imported: an all-zero salt is how the rest of the CLI
// knows no receipt has arrived yet (see `hasImportedEnrollment`).
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
    applicantSalt: new Uint8Array(32),
  });

type PublicDataProviders = Pick<AequiraProviders, 'publicDataProvider'>;

const readRoundLedger = async (
  providers: PublicDataProviders,
  contractAddress: ContractAddress,
): Promise<AequiraLedger> => {
  const ledgerState = await queryAequiraLedger(providers, contractAddress);

  if (ledgerState === null) {
    throw new Error('The indexer has not seen that contract address yet');
  }

  return ledgerState;
};

const toHex = (value: Uint8Array): string => Buffer.from(value).toString('hex');

export type CommandDependencies = {
  readonly createPublicDataProvider?: (config: CliConfig) => PublicDataProviders;
  readonly createWalletProvider?: typeof AequiraWalletProvider.create;
  readonly createRuntime?: typeof createAequiraRuntime;
  readonly deriveWalletAddress?: typeof deriveUnshieldedAddress;
  readonly deployContract?: typeof deployAequira;
  readonly generateSalt?: () => Uint8Array;
  readonly generateWalletSeed?: typeof generateRandomSeed;
  readonly joinContract?: typeof joinAequira;
  readonly promptSecret?: SecretPrompt;
  readonly readBackup?: typeof readRuntimeBackup;
  readonly readLedger?: typeof readRoundLedger;
  readonly readSecrets?: (
    config: CliConfig,
    promptSecret?: SecretPrompt,
  ) => Promise<RuntimeSecrets>;
  readonly readWalletSeed?: (config: CliConfig, promptSecret?: SecretPrompt) => Promise<Uint8Array>;
  readonly reportCleanupWarning?: (message: string) => void;
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
      `The enrollment receipt was imported locally for ${contractAddress}, but encrypted backup creation failed. Preserve the private-state directory and repair the backup — losing this local store loses the receipt's salt, and the institution would have to enroll you again during setup.`,
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
    await closeRuntime(runtime, dependencies);
  }
};

export type JoinCommandResult = {
  /** The public handle an applicant gives the institution to be enrolled. */
  readonly applicantId: string;
  readonly backupPath: string;
  readonly contractAddress: ContractAddress;
  readonly initializedPrivateState: boolean;
  readonly reviewerId: string;
};

export type RestoreCommandResult = {
  readonly applicantId: string;
  readonly contractAddress: ContractAddress;
  readonly restoredPrivateStates: number;
  readonly restoredSigningKeys: number;
  readonly reviewerId: string;
  /** Keys for other rounds this store already held, left untouched. */
  readonly skippedSigningKeys: number;
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
      applicantId: toHex(deriveApplicantId(activePrivateState.applicantSecret)),
      contractAddress,
      backupPath,
      initializedPrivateState: initialPrivateState !== undefined,
      reviewerId: toHex(deriveReviewerId(activePrivateState.reviewerSecret)),
    };
  } finally {
    if (existingPrivateState !== undefined) {
      clearPrivateState(existingPrivateState);
    }
    if (initialPrivateState !== undefined) {
      clearPrivateState(initialPrivateState);
    }

    secrets.walletSeed.fill(0);
    await closeRuntime(runtime, dependencies);
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

    let importedPrivateStates = false;

    try {
      // Private states are scoped to this contract, so they go first and a
      // conflict is a genuine error.
      const privateStateResult = await provider.importPrivateStates(backup.privateStates, {
        conflictStrategy: 'error',
        maxStates: 100,
      });
      importedPrivateStates = true;
      const importedPrivateState = await provider.get(AEQUIRA_PRIVATE_STATE_ID);

      if (importedPrivateState === null) {
        throw new Error('Backup did not restore the required AEQUIRA private state');
      }

      restoredPrivateState = importedPrivateState;
      validateAequiraPrivateState(importedPrivateState);

      // A signing-key export carries every key of the account, including other
      // rounds'. This contract was checked to have no key above, so skipping
      // conflicts only leaves other rounds' keys exactly as they already are.
      const signingKeyResult = await provider.importSigningKeys(backup.signingKeys, {
        conflictStrategy: 'skip',
        maxKeys: 100,
      });

      if ((await provider.getSigningKey(backup.contractAddress)) === null) {
        throw new Error('Backup did not restore the signing key for this contract');
      }

      return {
        applicantId: toHex(deriveApplicantId(importedPrivateState.applicantSecret)),
        contractAddress: backup.contractAddress,
        restoredPrivateStates: privateStateResult.imported,
        restoredSigningKeys: signingKeyResult.imported,
        reviewerId: toHex(deriveReviewerId(importedPrivateState.reviewerSecret)),
        skippedSigningKeys: signingKeyResult.skipped,
      };
    } catch (error) {
      // Undo only what this run added — neither existed before it started —
      // so a retry is not refused as an overwrite. Rollback failures must not
      // hide the original error.
      if (importedPrivateStates) {
        await provider.remove(AEQUIRA_PRIVATE_STATE_ID).catch(() => undefined);
      }
      if ((await provider.getSigningKey(backup.contractAddress).catch(() => null)) !== null) {
        await provider.removeSigningKey(backup.contractAddress).catch(() => undefined);
      }
      throw error;
    }
  } finally {
    if (restoredPrivateState !== undefined) {
      clearPrivateState(restoredPrivateState);
    }

    secrets.walletSeed.fill(0);
    await closeRuntime(runtime, dependencies);
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
    // Read before joining: a join stores a fresh signing key for a contract it
    // has none for, and that orphan key would later make `restore` refuse the
    // round. Reading first also spares a wallet sync that could not be used.
    currentPrivateState = await readExistingPrivateState(runtime, contractAddress);
    await runtime.wallet.start();
    await assertWalletHasDust(runtime.wallet);

    const contract = await joinForCall(
      runtime,
      contractAddress,
      dependencies.joinContract ?? joinAequira,
    );
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
    await closeRuntime(runtime, dependencies);
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
 *
 * Both calls check the public ledger first, before private state is touched or
 * a proof is paid for. A commit is refused for an ID that is not a submitted
 * application or that this reviewer already scored — the nullifier would make
 * a mistyped commit permanent. A reveal is refused unless the score reopens a
 * recorded commitment.
 */
const runScoreOpeningCall = async (
  config: CliConfig,
  contractAddress: ContractAddress,
  applicationId: Uint8Array,
  circuit: 'commitScore' | 'revealScore',
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
    const score = parseScore(
      await promptSecret(
        circuit === 'commitScore' ? 'Review score (0-100): ' : 'Score to reveal (0-100): ',
      ),
    );

    if (
      circuit === 'commitScore' &&
      parseScore(await promptSecret('Confirm review score: ')) !== score
    ) {
      throw new Error('The two scores do not match; nothing was submitted');
    }

    runtime = await (dependencies.createRuntime ?? createAequiraRuntime)({
      config,
      privateStatePassword: secrets.privateStatePassword,
      walletSeed: secrets.walletSeed,
    });
    // Read before joining: a join stores a fresh signing key for a contract it
    // has none for, and that orphan key would later make `restore` refuse the
    // round. Reading first also spares a wallet sync that could not be used.
    currentPrivateState = await readExistingPrivateState(runtime, contractAddress);
    await runtime.wallet.start();
    await assertWalletHasDust(runtime.wallet);

    const contract = await joinForCall(
      runtime,
      contractAddress,
      dependencies.joinContract ?? joinAequira,
    );
    const reviewerSecret = Uint8Array.from(currentPrivateState.reviewerSecret);
    const ledgerState = await (dependencies.readLedger ?? readRoundLedger)(
      runtime.providers,
      contractAddress,
    );
    const roundId = Uint8Array.from(ledgerState.roundId);
    const scoreSalt = await deriveScoreSalt(roundId, applicationId, reviewerSecret);

    if (circuit === 'commitScore') {
      if (!ledgerState.applications.member(applicationId)) {
        throw new Error(
          'That application ID is not a submitted application in this round; check round-status',
        );
      }
      if (
        ledgerState.scoreNullifiers.member(
          deriveScoreNullifier(roundId, applicationId, reviewerSecret),
        )
      ) {
        throw new Error('This reviewer already committed a score for that application');
      }
    } else if (
      !ledgerState.scoreCommitments.member(
        deriveScoreCommitment(roundId, applicationId, score, reviewerSecret, scoreSalt),
      )
    ) {
      throw new Error(
        'That score does not open a commitment recorded for this application; check the application ID and the score',
      );
    }

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
    await closeRuntime(runtime, dependencies);
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

export type RegisterApplicantCommandResult = Omit<TransactionCommandResult, 'backupPath'> & {
  readonly applicantId: string;
  readonly enrollmentLeaf: string;
  /** Private: the verified attributes and salt. Goes to the applicant only. */
  readonly enrollmentReceipt: string;
};

/**
 * The institution's side of enrollment. It verifies the applicant's attributes
 * out of band, types them at masked prompts, draws a fresh salt, and registers
 * the leaf built from the applicant's public ID — the applicant's secret is
 * never involved. The returned receipt is how the applicant learns the exact
 * attributes and salt `apply` must reopen, so a figure the institution did not
 * verify can never pass the eligibility check.
 *
 * No backup is written: the administrator's private state does not change, and
 * a failed backup must never cost the receipt of a finalized registration.
 */
export const runRegisterApplicantCommand = async (
  config: CliConfig,
  contractAddressValue: string,
  applicantIdHex: string,
  dependencies: CommandDependencies = {},
): Promise<RegisterApplicantCommandResult> => {
  const contractAddress = parseContractAddress(contractAddressValue);
  const applicantId = parseBytes32('applicant ID', applicantIdHex);
  const checks = await (dependencies.runPrerequisiteChecks ?? runDoctor)(config);
  assertDoctorReady(checks);
  const promptSecret = dependencies.promptSecret ?? promptHiddenSecret;
  const secrets = await (dependencies.readSecrets ?? readRuntimeSecrets)(config, promptSecret);
  let currentPrivateState: AequiraPrivateState | undefined;
  let runtime: AequiraRuntime | undefined;
  let salt: Uint8Array | undefined;

  try {
    const incomeBand = parseThreshold(
      'Income band',
      await promptSecret('Verified income band (0-255): '),
      255n,
    );
    const gpaScaled = parseThreshold(
      'Scaled grade average',
      await promptSecret('Verified scaled grade average (0-65535): '),
      65535n,
    );
    const regionCode = parseThreshold(
      'Region code',
      await promptSecret('Verified region code (0-255): '),
      255n,
    );
    runtime = await (dependencies.createRuntime ?? createAequiraRuntime)({
      config,
      privateStatePassword: secrets.privateStatePassword,
      walletSeed: secrets.walletSeed,
    });
    // Read before joining: a join stores a fresh signing key for a contract it
    // has none for, and that orphan key would later make `restore` refuse the
    // round. Reading first also spares a wallet sync that could not be used.
    currentPrivateState = await readExistingPrivateState(runtime, contractAddress);
    await runtime.wallet.start();
    await assertWalletHasDust(runtime.wallet);

    const contract = await joinForCall(
      runtime,
      contractAddress,
      dependencies.joinContract ?? joinAequira,
    );
    const ledgerState = await (dependencies.readLedger ?? readRoundLedger)(
      runtime.providers,
      contractAddress,
    );

    if (ledgerState.phase !== Phase.SETUP) {
      throw new Error('Applicants can only be enrolled while the round is in setup');
    }

    salt = (dependencies.generateSalt ?? (() => randomBytes(32)))();
    const { enrollmentLeaf, receipt } = issueEnrollmentReceipt({
      roundId: Uint8Array.from(ledgerState.roundId),
      applicantId,
      incomeBand,
      gpaScaled,
      regionCode,
      salt,
    });
    const txData = await contract.callTx.registerApplicant(enrollmentLeaf);

    return {
      contractAddress,
      transactionId: txData.public.txId,
      transactionHash: txData.public.txHash,
      blockHeight: txData.public.blockHeight,
      applicantId: toHex(applicantId),
      enrollmentLeaf: toHex(enrollmentLeaf),
      enrollmentReceipt: receipt,
    };
  } finally {
    if (currentPrivateState !== undefined) {
      clearPrivateState(currentPrivateState);
    }

    salt?.fill(0);
    secrets.walletSeed.fill(0);
    await closeRuntime(runtime, dependencies);
  }
};

export type ImportEnrollmentCommandResult = {
  readonly applicantId: string;
  readonly backupPath: string;
  readonly contractAddress: ContractAddress;
  /** Whether the institution's registration of this leaf is already on chain. */
  readonly enrolledOnChain: boolean;
  readonly enrollmentLeaf: string;
};

/**
 * The applicant's side of enrollment. Reads the institution's receipt at a
 * masked prompt, checks it against this round and this applicant's own secret,
 * and stores the attributes and salt in encrypted private state for `apply`.
 *
 * Needs no wallet sync and no Dust: nothing is submitted.
 */
export const runImportEnrollmentCommand = async (
  config: CliConfig,
  contractAddressValue: string,
  dependencies: CommandDependencies = {},
): Promise<ImportEnrollmentCommandResult> => {
  const contractAddress = parseContractAddress(contractAddressValue);
  const promptSecret = dependencies.promptSecret ?? promptHiddenSecret;
  const secrets = await (dependencies.readSecrets ?? readRuntimeSecrets)(config, promptSecret);
  let currentPrivateState: AequiraPrivateState | undefined;
  let nextPrivateState: AequiraPrivateState | undefined;
  let runtime: AequiraRuntime | undefined;

  try {
    const receiptText = await promptSecret('Enrollment receipt from the institution: ');
    runtime = await (dependencies.createRuntime ?? createAequiraRuntime)({
      config,
      privateStatePassword: secrets.privateStatePassword,
      walletSeed: secrets.walletSeed,
    });
    currentPrivateState = await readExistingPrivateState(runtime, contractAddress);
    const applicantSecret = Uint8Array.from(currentPrivateState.applicantSecret);
    const ledgerState = await (dependencies.readLedger ?? readRoundLedger)(
      runtime.providers,
      contractAddress,
    );
    const roundId = Uint8Array.from(ledgerState.roundId);

    if (ledgerState.phase > Phase.APPLY) {
      throw new Error('Enrollment receipts can only be imported before review opens');
    }
    if (ledgerState.applyNullifiers.member(deriveApplyNullifier(roundId, applicantSecret))) {
      throw new Error('This applicant already applied to the round; the enrollment cannot change');
    }

    const opened = openEnrollmentReceipt(receiptText, { roundId, applicantSecret });
    nextPrivateState = createAequiraPrivateState({
      ...currentPrivateState,
      applicantSecret,
      applicantIncomeBand: opened.incomeBand,
      applicantGpaScaled: opened.gpaScaled,
      applicantRegionCode: opened.regionCode,
      applicantSalt: opened.salt,
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
      applicantId: toHex(deriveApplicantId(applicantSecret)),
      backupPath,
      contractAddress,
      enrolledOnChain:
        ledgerState.applicantTree.findPathForLeaf(opened.enrollmentLeaf) !== undefined,
      enrollmentLeaf: toHex(opened.enrollmentLeaf),
    };
  } finally {
    if (currentPrivateState !== undefined) {
      clearPrivateState(currentPrivateState);
    }
    if (nextPrivateState !== undefined) {
      clearPrivateState(nextPrivateState);
    }

    secrets.walletSeed.fill(0);
    await closeRuntime(runtime, dependencies);
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
export type ApplyCommandResult = TransactionCommandResult & {
  /** The public pseudonym reviewers score. It names no one. */
  readonly applicationId: string;
};

export const runApplyCommand = async (
  config: CliConfig,
  contractAddressValue: string,
  dependencies: CommandDependencies = {},
): Promise<ApplyCommandResult> => {
  const contractAddress = parseContractAddress(contractAddressValue);
  const checks = await (dependencies.runPrerequisiteChecks ?? runDoctor)(config);
  assertDoctorReady(checks);
  const promptSecret = dependencies.promptSecret ?? promptHiddenSecret;
  const secrets = await (dependencies.readSecrets ?? readRuntimeSecrets)(config, promptSecret);
  let currentPrivateState: AequiraPrivateState | undefined;
  let runtime: AequiraRuntime | undefined;
  let applicantSecret: Uint8Array | undefined;
  let nonce: Uint8Array | undefined;

  try {
    runtime = await (dependencies.createRuntime ?? createAequiraRuntime)({
      config,
      privateStatePassword: secrets.privateStatePassword,
      walletSeed: secrets.walletSeed,
    });
    // Read before joining: a join stores a fresh signing key for a contract it
    // has none for, and that orphan key would later make `restore` refuse the
    // round. Reading first also spares a wallet sync that could not be used.
    currentPrivateState = await readExistingPrivateState(runtime, contractAddress);
    await runtime.wallet.start();
    await assertWalletHasDust(runtime.wallet);

    const contract = await joinForCall(
      runtime,
      contractAddress,
      dependencies.joinContract ?? joinAequira,
    );

    if (!hasImportedEnrollment(currentPrivateState)) {
      throw new Error(
        'No enrollment receipt has been imported for this round; run import-enrollment first',
      );
    }

    applicantSecret = Uint8Array.from(currentPrivateState.applicantSecret);
    const ledgerState = await (dependencies.readLedger ?? readRoundLedger)(
      runtime.providers,
      contractAddress,
    );
    const roundId = Uint8Array.from(ledgerState.roundId);
    nonce = await deriveApplicationNonce(roundId, applicantSecret);
    const applicationId = toHex(deriveApplicationPseudonym(roundId, applicantSecret, nonce));

    if (ledgerState.applyNullifiers.member(deriveApplyNullifier(roundId, applicantSecret))) {
      throw new Error(
        `This applicant already applied to the round as application ${applicationId}`,
      );
    }

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

    return {
      ...toTransactionCommandResult(contractAddress, txData.public, backupPath),
      applicationId,
    };
  } finally {
    if (currentPrivateState !== undefined) {
      clearPrivateState(currentPrivateState);
    }

    applicantSecret?.fill(0);
    nonce?.fill(0);
    secrets.walletSeed.fill(0);
    await closeRuntime(runtime, dependencies);
  }
};

export type RoundStatusApplication = {
  readonly applicationId: string;
  /** Present once at least one reviewer has revealed a score for it. */
  readonly revealedCount: string | null;
  readonly scoreSum: string | null;
};

export type RoundStatus = {
  readonly applications: readonly RoundStatusApplication[];
  readonly applyNullifiers: string;
  /** Leaves the institution registered; a re-issued receipt adds one more. */
  readonly enrollmentLeaves: string;
  readonly maxIncomeBand: string;
  readonly minGpaScaled: string;
  readonly phase: string;
  readonly reviewers: readonly string[];
  readonly scoreCommitments: string;
  readonly scoreNullifiers: string;
};

/** Everything a reviewer or observer needs from the public ledger, and nothing else. */
export const toRoundStatus = (ledgerState: AequiraLedger): RoundStatus => ({
  applications: [...ledgerState.applications].map((applicationId) => ({
    applicationId: toHex(applicationId),
    revealedCount: ledgerState.revealedCounts.member(applicationId)
      ? ledgerState.revealedCounts.lookup(applicationId).read().toString()
      : null,
    scoreSum: ledgerState.scoreSums.member(applicationId)
      ? ledgerState.scoreSums.lookup(applicationId).read().toString()
      : null,
  })),
  applyNullifiers: ledgerState.applyNullifiers.size().toString(),
  enrollmentLeaves: ledgerState.applicantTree.firstFree().toString(),
  maxIncomeBand: ledgerState.maxIncomeBand.toString(),
  minGpaScaled: ledgerState.minGpaScaled.toString(),
  phase: Phase[ledgerState.phase] ?? `UNKNOWN(${ledgerState.phase})`,
  reviewers: [...ledgerState.reviewers].map(toHex),
  scoreCommitments: ledgerState.scoreCommitments.size().toString(),
  scoreNullifiers: ledgerState.scoreNullifiers.size().toString(),
});

/** Reads the public ledger only: no wallet, no password, no private state. */
export const runRoundStatusCommand = async (
  config: CliConfig,
  contractAddressValue: string,
  dependencies: CommandDependencies = {},
): Promise<RoundStatus> => {
  const contractAddress = parseContractAddress(contractAddressValue);
  const providers =
    dependencies.createPublicDataProvider?.(config) ??
    (() => {
      setNetworkId(config.network);
      return { publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWs) };
    })();

  return toRoundStatus(
    await (dependencies.readLedger ?? readRoundLedger)(providers, contractAddress),
  );
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
