import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, mkdir, open, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AequiraProviders } from '@aequira/sdk';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { assertIsContractAddress, validatePassword } from '@midnight-ntwrk/midnight-js-utils';

import type { CliConfig } from './config.js';

export const BACKUP_FORMAT = 'aequira-runtime-backup';
export const BACKUP_VERSION = 2;
const MAX_BACKUP_BYTES = 16 * 1024 * 1024;
const HEX_32_PATTERN = /^[0-9a-fA-F]{64}$/;
const BACKUP_AUTHENTICATION_ALGORITHM = 'scrypt-hmac-sha256';

export type RuntimeBackup = {
  readonly authentication: {
    readonly algorithm: typeof BACKUP_AUTHENTICATION_ALGORITHM;
    readonly salt: string;
    readonly tag: string;
  };
  readonly contractAddress: ContractAddress;
  readonly createdAt: string;
  readonly format: typeof BACKUP_FORMAT;
  readonly network: CliConfig['network'];
  readonly privateStates: Awaited<
    ReturnType<AequiraProviders['privateStateProvider']['exportPrivateStates']>
  >;
  readonly signingKeys: Awaited<
    ReturnType<AequiraProviders['privateStateProvider']['exportSigningKeys']>
  >;
  readonly version: typeof BACKUP_VERSION;
};

export type WriteRuntimeBackupOptions = {
  readonly authenticationPassword: string;
  readonly config: CliConfig;
  readonly contractAddress: ContractAddress;
  readonly now?: () => Date;
  readonly privateStateProvider: AequiraProviders['privateStateProvider'];
};

type RuntimeBackupPayload = Omit<RuntimeBackup, 'authentication'>;

const deriveAuthenticationKey = (password: string, salt: Uint8Array): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCallback(password, salt, 32, (error, key) => {
      if (error !== null) {
        reject(error);
        return;
      }

      resolve(key);
    });
  });

const serializeAuthenticatedPayload = (backup: RuntimeBackupPayload): string =>
  JSON.stringify({
    format: backup.format,
    version: backup.version,
    network: backup.network,
    contractAddress: backup.contractAddress,
    createdAt: backup.createdAt,
    privateStates: {
      format: backup.privateStates.format,
      encryptedPayload: backup.privateStates.encryptedPayload,
      salt: backup.privateStates.salt,
    },
    signingKeys: {
      format: backup.signingKeys.format,
      encryptedPayload: backup.signingKeys.encryptedPayload,
      salt: backup.signingKeys.salt,
    },
  });

const computeAuthenticationTag = async (
  backup: RuntimeBackupPayload,
  password: string,
  salt: Uint8Array,
): Promise<string> => {
  const key = await deriveAuthenticationKey(password, salt);

  try {
    return createHmac('sha256', key)
      .update(serializeAuthenticatedPayload(backup), 'utf8')
      .digest('hex');
  } finally {
    key.fill(0);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertEncryptedExport = (
  value: unknown,
  format: 'midnight-private-state-export' | 'midnight-signing-key-export',
): void => {
  if (
    !isRecord(value) ||
    value.format !== format ||
    typeof value.encryptedPayload !== 'string' ||
    value.encryptedPayload.length === 0 ||
    typeof value.salt !== 'string' ||
    !HEX_32_PATTERN.test(value.salt)
  ) {
    throw new Error('Backup contains an invalid encrypted export');
  }
};

export const parseRuntimeBackup = (value: unknown): RuntimeBackup => {
  if (
    !isRecord(value) ||
    value.format !== BACKUP_FORMAT ||
    value.version !== BACKUP_VERSION ||
    (value.network !== 'preview' && value.network !== 'preprod') ||
    typeof value.contractAddress !== 'string' ||
    typeof value.createdAt !== 'string' ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    !isRecord(value.authentication) ||
    value.authentication.algorithm !== BACKUP_AUTHENTICATION_ALGORITHM ||
    typeof value.authentication.salt !== 'string' ||
    !HEX_32_PATTERN.test(value.authentication.salt) ||
    typeof value.authentication.tag !== 'string' ||
    !HEX_32_PATTERN.test(value.authentication.tag)
  ) {
    throw new Error('Backup format is invalid or unsupported');
  }

  try {
    assertIsContractAddress(value.contractAddress);
  } catch {
    throw new Error('Backup contains an invalid contract address');
  }

  assertEncryptedExport(value.privateStates, 'midnight-private-state-export');
  assertEncryptedExport(value.signingKeys, 'midnight-signing-key-export');

  return value as RuntimeBackup;
};

export const verifyRuntimeBackupAuthentication = async (
  backup: RuntimeBackup,
  password: string,
): Promise<void> => {
  const { authentication, ...payload } = backup;
  const expectedTag = await computeAuthenticationTag(
    payload,
    password,
    Buffer.from(authentication.salt, 'hex'),
  );
  const actualTagBytes = Buffer.from(authentication.tag, 'hex');
  const expectedTagBytes = Buffer.from(expectedTag, 'hex');

  if (
    actualTagBytes.byteLength !== expectedTagBytes.byteLength ||
    !timingSafeEqual(actualTagBytes, expectedTagBytes)
  ) {
    throw new Error('Backup authentication failed');
  }
};

export const readRuntimeBackup = async (backupPath: string): Promise<RuntimeBackup> => {
  let file;

  try {
    file = await open(backupPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new Error('Backup file could not be opened');
  }

  try {
    const fileStat = await file.stat();

    if (!fileStat.isFile()) {
      throw new Error('Backup path must reference a regular file');
    }
    if (fileStat.size === 0 || fileStat.size > MAX_BACKUP_BYTES) {
      throw new Error('Backup file size is invalid');
    }
    if ((fileStat.mode & 0o077) !== 0) {
      throw new Error('Backup file permissions must not allow group or public access');
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(await file.readFile({ encoding: 'utf8' }));
    } catch {
      throw new Error('Backup file does not contain valid JSON');
    }

    return parseRuntimeBackup(parsed);
  } finally {
    await file.close();
  }
};

export const writeRuntimeBackup = async (options: WriteRuntimeBackupOptions): Promise<string> => {
  const {
    authenticationPassword,
    config,
    contractAddress,
    privateStateProvider,
    now = () => new Date(),
  } = options;
  assertIsContractAddress(contractAddress);
  validatePassword(authenticationPassword);
  privateStateProvider.setContractAddress(contractAddress);

  const privateStates = await privateStateProvider.exportPrivateStates({
    maxStates: 100,
  });
  const signingKeys = await privateStateProvider.exportSigningKeys({
    maxKeys: 100,
  });
  const createdAt = now();
  const payload: RuntimeBackupPayload = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    network: config.network,
    contractAddress,
    createdAt: createdAt.toISOString(),
    privateStates,
    signingKeys,
  };
  const authenticationSalt = randomBytes(32);
  const authenticationTag = await computeAuthenticationTag(
    payload,
    authenticationPassword,
    authenticationSalt,
  );
  const backup: RuntimeBackup = {
    ...payload,
    authentication: {
      algorithm: BACKUP_AUTHENTICATION_ALGORITHM,
      salt: authenticationSalt.toString('hex'),
      tag: authenticationTag,
    },
  };
  const backupDirectory = path.join(config.privateStateDirectory, 'backups');
  const filename = `${config.network}-${contractAddress}-${createdAt.getTime()}.backup.json`;
  const backupPath = path.join(backupDirectory, filename);

  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  await chmod(backupDirectory, 0o700);
  await writeFile(backupPath, `${JSON.stringify(backup, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });

  return backupPath;
};
