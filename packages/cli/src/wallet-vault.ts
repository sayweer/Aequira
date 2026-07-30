import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCallback,
} from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, mkdir, open, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { validatePassword } from '@midnight-ntwrk/midnight-js-utils';

import type { CliConfig } from './config.js';

export const WALLET_VAULT_FORMAT = 'aequira-development-wallet';
export const WALLET_VAULT_VERSION = 1;

const WALLET_SEED_BYTES = 32;
const WALLET_VAULT_MAX_BYTES = 16 * 1024;
const WALLET_VAULT_ALGORITHM = 'aes-256-gcm';
const WALLET_VAULT_KDF = 'scrypt';
const HEX_12_PATTERN = /^[0-9a-f]{24}$/;
const HEX_16_PATTERN = /^[0-9a-f]{32}$/;
const HEX_32_PATTERN = /^[0-9a-f]{64}$/;

export type WalletVault = {
  readonly cipher: {
    readonly algorithm: typeof WALLET_VAULT_ALGORITHM;
    readonly authenticationTag: string;
    readonly ciphertext: string;
    readonly iv: string;
  };
  readonly createdAt: string;
  readonly format: typeof WALLET_VAULT_FORMAT;
  readonly kdf: {
    readonly algorithm: typeof WALLET_VAULT_KDF;
    readonly salt: string;
  };
  readonly network: CliConfig['network'];
  readonly version: typeof WALLET_VAULT_VERSION;
};

export type WriteWalletVaultOptions = {
  readonly config: CliConfig;
  readonly now?: () => Date;
  readonly password: string;
  readonly seed: Uint8Array;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const deriveWalletEncryptionKey = (password: string, salt: Uint8Array): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCallback(password, salt, 32, (error, key) => {
      if (error !== null) {
        reject(error);
        return;
      }

      resolve(key);
    });
  });

const walletVaultAuthenticatedData = (
  vault: Pick<WalletVault, 'createdAt' | 'format' | 'network' | 'version'>,
): Buffer =>
  Buffer.from(
    JSON.stringify({
      format: vault.format,
      version: vault.version,
      network: vault.network,
      createdAt: vault.createdAt,
    }),
    'utf8',
  );

export const getWalletVaultPath = (config: CliConfig): string =>
  path.join(config.privateStateDirectory, 'wallets', `${config.network}.wallet.json`);

export const parseWalletVault = (value: unknown): WalletVault => {
  if (
    !isRecord(value) ||
    value.format !== WALLET_VAULT_FORMAT ||
    value.version !== WALLET_VAULT_VERSION ||
    (value.network !== 'preview' && value.network !== 'preprod') ||
    typeof value.createdAt !== 'string' ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    !isRecord(value.kdf) ||
    value.kdf.algorithm !== WALLET_VAULT_KDF ||
    typeof value.kdf.salt !== 'string' ||
    !HEX_32_PATTERN.test(value.kdf.salt) ||
    !isRecord(value.cipher) ||
    value.cipher.algorithm !== WALLET_VAULT_ALGORITHM ||
    typeof value.cipher.iv !== 'string' ||
    !HEX_12_PATTERN.test(value.cipher.iv) ||
    typeof value.cipher.authenticationTag !== 'string' ||
    !HEX_16_PATTERN.test(value.cipher.authenticationTag) ||
    typeof value.cipher.ciphertext !== 'string' ||
    !HEX_32_PATTERN.test(value.cipher.ciphertext)
  ) {
    throw new Error('Development wallet vault format is invalid or unsupported');
  }

  return value as WalletVault;
};

export const writeWalletVault = async (options: WriteWalletVaultOptions): Promise<string> => {
  const { config, password, seed, now = () => new Date() } = options;

  if (seed.byteLength !== WALLET_SEED_BYTES) {
    throw new RangeError(`wallet seed must contain exactly ${WALLET_SEED_BYTES} bytes`);
  }

  validatePassword(password);

  const createdAt = now().toISOString();
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = await deriveWalletEncryptionKey(password, salt);
  let ciphertext: Buffer;
  let authenticationTag: Buffer;

  try {
    const cipher = createCipheriv(WALLET_VAULT_ALGORITHM, key, iv);
    cipher.setAAD(
      walletVaultAuthenticatedData({
        format: WALLET_VAULT_FORMAT,
        version: WALLET_VAULT_VERSION,
        network: config.network,
        createdAt,
      }),
    );
    ciphertext = Buffer.concat([cipher.update(seed), cipher.final()]);
    authenticationTag = cipher.getAuthTag();
  } finally {
    key.fill(0);
  }

  const vault: WalletVault = {
    format: WALLET_VAULT_FORMAT,
    version: WALLET_VAULT_VERSION,
    network: config.network,
    createdAt,
    kdf: {
      algorithm: WALLET_VAULT_KDF,
      salt: salt.toString('hex'),
    },
    cipher: {
      algorithm: WALLET_VAULT_ALGORITHM,
      iv: iv.toString('hex'),
      authenticationTag: authenticationTag.toString('hex'),
      ciphertext: ciphertext.toString('hex'),
    },
  };
  const vaultPath = getWalletVaultPath(config);
  const vaultDirectory = path.dirname(vaultPath);

  await mkdir(vaultDirectory, { recursive: true, mode: 0o700 });
  await chmod(vaultDirectory, 0o700);

  try {
    await writeFile(vaultPath, `${JSON.stringify(vault, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if (isRecord(error) && error.code === 'EEXIST') {
      throw new Error(
        `A development wallet already exists for ${config.network}; refusing to overwrite it`,
      );
    }
    throw error;
  }

  return vaultPath;
};

export const readWalletVault = async (config: CliConfig, password: string): Promise<Uint8Array> => {
  validatePassword(password);
  const vaultPath = getWalletVaultPath(config);
  let file;

  try {
    file = await open(vaultPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new Error(
      `No encrypted development wallet exists for ${config.network}; run wallet-create first`,
    );
  }

  try {
    const fileStat = await file.stat();

    if (!fileStat.isFile()) {
      throw new Error('Development wallet vault path must reference a regular file');
    }
    if (fileStat.size === 0 || fileStat.size > WALLET_VAULT_MAX_BYTES) {
      throw new Error('Development wallet vault file size is invalid');
    }
    if ((fileStat.mode & 0o077) !== 0) {
      throw new Error('Development wallet vault permissions must not allow group or public access');
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(await file.readFile({ encoding: 'utf8' }));
    } catch {
      throw new Error('Development wallet vault does not contain valid JSON');
    }

    const vault = parseWalletVault(parsed);

    if (vault.network !== config.network) {
      throw new Error(
        `Development wallet network ${vault.network} does not match configured network ${config.network}`,
      );
    }

    const key = await deriveWalletEncryptionKey(password, Buffer.from(vault.kdf.salt, 'hex'));
    let plaintext: Buffer | undefined;

    try {
      const decipher = createDecipheriv(
        WALLET_VAULT_ALGORITHM,
        key,
        Buffer.from(vault.cipher.iv, 'hex'),
      );
      decipher.setAAD(walletVaultAuthenticatedData(vault));
      decipher.setAuthTag(Buffer.from(vault.cipher.authenticationTag, 'hex'));
      plaintext = Buffer.concat([
        decipher.update(Buffer.from(vault.cipher.ciphertext, 'hex')),
        decipher.final(),
      ]);
    } catch {
      plaintext?.fill(0);
      throw new Error('Development wallet vault decryption failed');
    } finally {
      key.fill(0);
    }

    if (plaintext.byteLength !== WALLET_SEED_BYTES) {
      plaintext.fill(0);
      throw new Error('Development wallet vault contains an invalid seed');
    }

    return plaintext;
  } finally {
    await file.close();
  }
};
