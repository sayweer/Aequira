import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AequiraProviders } from '@aequira/sdk';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { assertIsContractAddress } from '@midnight-ntwrk/midnight-js-utils';

import type { CliConfig } from './config.js';

const BACKUP_FORMAT = 'aequira-runtime-backup';
const BACKUP_VERSION = 1;

export type RuntimeBackup = {
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
  readonly config: CliConfig;
  readonly contractAddress: ContractAddress;
  readonly now?: () => Date;
  readonly privateStateProvider: AequiraProviders['privateStateProvider'];
};

export const writeRuntimeBackup = async (options: WriteRuntimeBackupOptions): Promise<string> => {
  const { config, contractAddress, privateStateProvider, now = () => new Date() } = options;
  assertIsContractAddress(contractAddress);
  privateStateProvider.setContractAddress(contractAddress);

  const [privateStates, signingKeys] = await Promise.all([
    privateStateProvider.exportPrivateStates({ maxStates: 100 }),
    privateStateProvider.exportSigningKeys({ maxKeys: 100 }),
  ]);
  const createdAt = now();
  const backup: RuntimeBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    network: config.network,
    contractAddress,
    createdAt: createdAt.toISOString(),
    privateStates,
    signingKeys,
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
