import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { describe, test } from 'node:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AEQUIRA_PRIVATE_STATE_ID } from '@aequira/sdk';
import {
  sampleContractAddress,
  sampleSigningKey,
} from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  AequiraWalletProvider,
  DeploymentBackupError,
  DustRegistrationCleanupError,
  EncryptedPrivateStateStore,
  FinalizedCallBackupError,
  loadCliConfig,
  getWalletVaultPath,
  parseBytes32,
  parseCliArguments,
  parseScore,
  parseWalletSeed,
  promptHiddenSecret,
  readRuntimeBackup,
  readWalletVault,
  redactErrorMessage,
  readRuntimeSecrets,
  readWalletSeed,
  runCommitScoreCommand,
  runDeployCommand,
  runDoctor,
  runFundingStatusCommand,
  runJoinCommand,
  runPhaseCommand,
  runRegisterDustCommand,
  runRegisterReviewerCommand,
  runRestoreCommand,
  runRevealScoreCommand,
  runWalletAddressCommand,
  runWalletCreateCommand,
  verifyRuntimeBackupAuthentication,
  writeRuntimeBackup,
  writeWalletVault,
} from '../dist/index.js';

const readDirectory = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      contents.push(await readDirectory(entryPath));
    } else {
      contents.push(await readFile(entryPath));
    }
  }

  return Buffer.concat(contents);
};

describe('AEQUIRA CLI configuration', () => {
  test('loads the official preprod endpoints by default', () => {
    const config = loadCliConfig({ environment: {} });

    assert.equal(config.network, 'preprod');
    assert.equal(config.indexer, 'https://indexer.preprod.midnight.network/api/v4/graphql');
    assert.equal(config.proofServer, 'http://127.0.0.1:6300');
    assert.equal(
      config.privateStateDirectory,
      fileURLToPath(new URL('../../../.private-state/aequira/', import.meta.url)).replace(
        /\/$/,
        '',
      ),
    );
  });

  test('rejects unsupported networks and credential-bearing URLs', () => {
    assert.throws(
      () => loadCliConfig({ environment: {}, network: 'mainnet' }),
      /Unsupported network/,
    );
    assert.throws(
      () =>
        loadCliConfig({
          environment: {},
          proofServer: 'http://user:password@127.0.0.1:6300',
        }),
      /must not contain credentials/,
    );
    assert.throws(
      () =>
        loadCliConfig({
          environment: {
            AEQUIRA_PRIVATE_STATE_DIR: path.parse(process.cwd()).root,
          },
        }),
      /must not be a filesystem root/,
    );
  });

  test('forbids secrets in process arguments', () => {
    assert.throws(
      () => parseCliArguments(['doctor', '--wallet-seed', 'secret']),
      /secrets must never be passed/,
    );

    assert.throws(
      () => parseCliArguments(['doctor', '--password=do-not-echo-this']),
      (error) =>
        error instanceof Error &&
        !error.message.includes('do-not-echo-this') &&
        error.message.includes('--password is forbidden'),
    );
  });

  test('requires public deploy and join identifiers', () => {
    assert.throws(() => parseCliArguments(['deploy']), /requires --round-id/);
    assert.throws(() => parseCliArguments(['join']), /requires --contract-address/);
    assert.equal(
      parseCliArguments(['deploy', '--round-id', 'ab'.repeat(32)]).roundId,
      'ab'.repeat(32),
    );
    assert.throws(
      () => parseCliArguments(['commit-score', '--contract-address', sampleContractAddress()]),
      /requires --application-id/,
    );
    assert.throws(
      () =>
        parseCliArguments([
          'commit-score',
          '--contract-address',
          sampleContractAddress(),
          '--application-id',
          'ab'.repeat(32),
          '--score=91',
        ]),
      (error) =>
        error instanceof Error &&
        error.message.includes('--score is forbidden') &&
        !error.message.includes('91'),
    );
    assert.throws(
      () => parseCliArguments(['register-reviewer', '--contract-address', sampleContractAddress()]),
      /requires --reviewer-id/,
    );
    assert.throws(() => parseCliArguments(['restore']), /requires --backup-file/);
    assert.equal(
      parseCliArguments(['restore', '--backup-file', '/private/backup.json']).backupFile,
      '/private/backup.json',
    );
    assert.deepEqual(parseCliArguments(['funding-status', '--network', 'preview']), {
      command: 'funding-status',
      json: false,
      network: 'preview',
    });
    assert.equal(parseCliArguments(['register-dust']).command, 'register-dust');
    assert.equal(parseCliArguments(['wallet-create']).command, 'wallet-create');
  });

  test('reports deterministic doctor results with injected adapters', async () => {
    const config = loadCliConfig({ environment: {} });
    const checks = await runDoctor(config, {
      accessFile: async () => undefined,
      fetchUrl: async () => new Response(null, { status: 404 }),
      nodeVersion: '24.11.1',
    });

    assert.deepEqual(
      checks.map(({ name, ok }) => ({ name, ok })),
      [
        { name: 'node', ok: true },
        { name: 'zk-assets', ok: true },
        { name: 'network-node', ok: true },
        { name: 'indexer', ok: true },
        { name: 'proof-server', ok: true },
      ],
    );

    const networkFailure = await runDoctor(config, {
      accessFile: async () => undefined,
      fetchUrl: async (url) => {
        if (url === config.node) {
          throw new Error('network node unavailable');
        }
        return new Response(null, { status: 200 });
      },
      nodeVersion: '24.11.1',
    });
    assert.equal(networkFailure.find(({ name }) => name === 'network-node')?.ok, false);
    assert.equal(networkFailure.find(({ name }) => name === 'indexer')?.ok, true);
    assert.equal(networkFailure.find(({ name }) => name === 'proof-server')?.ok, true);
  });

  test('rejects Node versions below the pinned minimum', async () => {
    const config = loadCliConfig({ environment: {} });
    const checks = await runDoctor(config, {
      accessFile: async () => undefined,
      fetchUrl: async () => new Response(null, { status: 200 }),
      nodeVersion: '24.11.0',
    });

    assert.equal(checks.find(({ name }) => name === 'node')?.ok, false);
  });
});

describe('AEQUIRA CLI secret input', () => {
  test('parses fixed-size seed and public bytes without retaining invalid values', () => {
    assert.deepEqual(parseWalletSeed('ab'.repeat(32)), Buffer.alloc(32, 0xab));
    assert.deepEqual(parseBytes32('round ID', 'cd'.repeat(32)), Buffer.alloc(32, 0xcd));
    assert.throws(() => parseWalletSeed('not-a-wallet-seed'), /exactly 64 hexadecimal characters/);
    assert.equal(parseScore('0'), 0n);
    assert.equal(parseScore('100'), 100n);
    assert.throws(() => parseScore('101'), /between 0 and 100/);
    assert.throws(() => parseScore('1.5'), /between 0 and 100/);
  });

  test('refuses secrets from non-interactive streams', async () => {
    await assert.rejects(
      promptHiddenSecret('Secret: ', {
        input: { isTTY: false },
        output: { isTTY: true },
      }),
      /interactive TTY/,
    );
  });

  test('reads the encrypted wallet and strong storage password only through masked prompts', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'aequira-wallet-input-'));
    const config = loadCliConfig({
      environment: { AEQUIRA_PRIVATE_STATE_DIR: directory },
    });
    const walletPassword = 'V9!qR2@mL7#xT4$p';
    const storagePassword = 'R7!mQ2@vL9#zT4$p';
    const seed = Buffer.alloc(32, 1);

    try {
      await writeWalletVault({
        config,
        password: walletPassword,
        seed,
      });
      const answers = [walletPassword, storagePassword];
      const secrets = await readRuntimeSecrets(config, async () => answers.shift());

      assert.deepEqual(secrets.walletSeed, seed);
      assert.equal(secrets.privateStatePassword, storagePassword);
      secrets.walletSeed.fill(0);
    } finally {
      seed.fill(0);
      await rm(directory, { force: true, recursive: true });
    }
  });

  test('unlocks an address-only wallet without requesting a storage password', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'aequira-wallet-address-input-'));
    const config = loadCliConfig({
      environment: { AEQUIRA_PRIVATE_STATE_DIR: directory },
    });
    const walletPassword = 'V9!qR2@mL7#xT4$p';
    const sourceSeed = Buffer.alloc(32, 2);
    const labels = [];

    try {
      await writeWalletVault({
        config,
        password: walletPassword,
        seed: sourceSeed,
      });
      const seed = await readWalletSeed(config, async (label) => {
        labels.push(label);
        return walletPassword;
      });

      assert.deepEqual(seed, sourceSeed);
      assert.deepEqual(labels, ['Development-wallet password: ']);
      seed.fill(0);
    } finally {
      sourceSeed.fill(0);
      await rm(directory, { force: true, recursive: true });
    }
  });

  test('redacts local project and home paths from user-facing errors', () => {
    const message = redactErrorMessage(new Error(`${process.cwd()}/secret ${tmpdir()}/not-home`));

    assert.equal(message.includes(process.cwd()), false);
    assert.match(message, /<project-directory>/);
  });
});

describe('AEQUIRA CLI secret storage', () => {
  test('encrypts the development wallet seed in a non-overwriting 0600 vault', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'aequira-wallet-vault-'));
    const config = loadCliConfig({
      environment: { AEQUIRA_PRIVATE_STATE_DIR: directory },
    });
    const password = 'V9!qR2@mL7#xT4$p';
    const wrongPassword = 'W8@kP3#nV6!cR2$x';
    const seed = Buffer.alloc(32, 0x7a);

    try {
      const vaultPath = await writeWalletVault({
        config,
        password,
        seed,
        now: () => new Date('2026-07-30T00:00:00.000Z'),
      });
      const rawVault = await readFile(vaultPath, 'utf8');

      assert.equal(vaultPath, getWalletVaultPath(config));
      assert.equal((await stat(vaultPath)).mode & 0o777, 0o600);
      assert.equal((await stat(path.dirname(vaultPath))).mode & 0o777, 0o700);
      assert.equal(rawVault.includes(seed.toString('hex')), false);

      const restoredSeed = await readWalletVault(config, password);
      assert.deepEqual(restoredSeed, seed);
      restoredSeed.fill(0);
      await assert.rejects(readWalletVault(config, wrongPassword), /decryption failed/);
      await assert.rejects(writeWalletVault({ config, password, seed }), /refusing to overwrite/);

      await chmod(vaultPath, 0o644);
      await assert.rejects(
        readWalletVault(config, password),
        /must not allow group or public access/,
      );
    } finally {
      seed.fill(0);
      await rm(directory, { force: true, recursive: true });
    }
  });

  test('encrypts account-scoped private state and clears its password holder', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'aequira-private-state-'));
    const config = loadCliConfig({
      environment: { AEQUIRA_PRIVATE_STATE_DIR: directory },
    });
    const password = 'R7!mQ2@vL9#zT4$p';
    const wrongPassword = 'W8@kP3#nV6!cR2$x';
    const sentinel = 'AEQUIRA_PRIVATE_STATE_MUST_BE_ENCRYPTED_7f3b';
    const contractAddress = sampleContractAddress();
    let store;
    let wrongPasswordStore;

    try {
      store = await EncryptedPrivateStateStore.create(config, 'account-one', password);
      store.provider.setContractAddress(contractAddress);
      await store.provider.set(AEQUIRA_PRIVATE_STATE_ID, { sentinel });

      assert.deepEqual(await store.provider.get(AEQUIRA_PRIVATE_STATE_ID), {
        sentinel,
      });
      assert.equal((await stat(directory)).mode & 0o777, 0o700);

      await store.dispose();
      store = undefined;

      const rawDatabase = await readDirectory(directory);
      assert.equal(rawDatabase.includes(Buffer.from(sentinel)), false);

      wrongPasswordStore = await EncryptedPrivateStateStore.create(
        config,
        'account-one',
        wrongPassword,
      );
      wrongPasswordStore.provider.setContractAddress(contractAddress);
      await assert.rejects(wrongPasswordStore.provider.get(AEQUIRA_PRIVATE_STATE_ID));
    } finally {
      await store?.dispose();
      await wrongPasswordStore?.dispose();
      await rm(directory, { force: true, recursive: true });
    }
  });

  test('writes encrypted runtime exports to a non-overwriting 0600 backup', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'aequira-backup-'));
    const config = loadCliConfig({
      environment: { AEQUIRA_PRIVATE_STATE_DIR: directory },
    });
    const contractAddress = sampleContractAddress();
    const now = () => new Date('2026-07-30T00:00:00.000Z');
    const provider = {
      setContractAddress: () => undefined,
      exportPrivateStates: async () => ({
        format: 'midnight-private-state-export',
        encryptedPayload: 'encrypted-private-state',
        salt: '11'.repeat(32),
      }),
      exportSigningKeys: async () => ({
        format: 'midnight-signing-key-export',
        encryptedPayload: 'encrypted-signing-keys',
        salt: '22'.repeat(32),
      }),
    };

    try {
      const backupPath = await writeRuntimeBackup({
        authenticationPassword: 'R7!mQ2@vL9#zT4$p',
        config,
        contractAddress,
        privateStateProvider: provider,
        now,
      });
      const backup = JSON.parse(await readFile(backupPath, 'utf8'));

      assert.equal((await stat(backupPath)).mode & 0o777, 0o600);
      assert.equal((await stat(path.dirname(backupPath))).mode & 0o777, 0o700);
      assert.equal(backup.contractAddress, contractAddress);
      assert.equal(backup.privateStates.encryptedPayload, 'encrypted-private-state');
      assert.deepEqual(await readRuntimeBackup(backupPath), backup);
      await chmod(backupPath, 0o644);
      await assert.rejects(readRuntimeBackup(backupPath), /must not allow group or public access/);
      await chmod(backupPath, 0o600);
      await assert.rejects(
        writeRuntimeBackup({
          authenticationPassword: 'R7!mQ2@vL9#zT4$p',
          config,
          contractAddress,
          privateStateProvider: provider,
          now,
        }),
        { code: 'EEXIST' },
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test('rejects weak storage passwords before opening the database', async () => {
    const config = loadCliConfig({ environment: {} });

    await assert.rejects(EncryptedPrivateStateStore.create(config, 'account-one', 'weak'));
  });

  test('round-trips an encrypted backup through the real Level provider', async () => {
    const sourceDirectory = await mkdtemp(path.join(tmpdir(), 'aequira-backup-source-'));
    const targetDirectory = await mkdtemp(path.join(tmpdir(), 'aequira-backup-target-'));
    const sourceConfig = loadCliConfig({
      environment: { AEQUIRA_PRIVATE_STATE_DIR: sourceDirectory },
    });
    const targetConfig = loadCliConfig({
      environment: { AEQUIRA_PRIVATE_STATE_DIR: targetDirectory },
    });
    const contractAddress = sampleContractAddress();
    const signingKey = sampleSigningKey();
    const privateState = {
      adminSecret: new Uint8Array(32).fill(1),
      reviewerSecret: new Uint8Array(32).fill(2),
      score: 73n,
      scoreSalt: new Uint8Array(32).fill(3),
    };
    const password = 'R7!mQ2@vL9#zT4$p';
    let sourceStore;
    let targetStore;

    try {
      sourceStore = await EncryptedPrivateStateStore.create(sourceConfig, 'account-one', password);
      sourceStore.provider.setContractAddress(contractAddress);
      await sourceStore.provider.set(AEQUIRA_PRIVATE_STATE_ID, privateState);
      await sourceStore.provider.setSigningKey(contractAddress, signingKey);
      const backupPath = await writeRuntimeBackup({
        authenticationPassword: password,
        config: sourceConfig,
        contractAddress,
        privateStateProvider: sourceStore.provider,
      });
      const backup = await readRuntimeBackup(backupPath);
      await assert.doesNotReject(verifyRuntimeBackupAuthentication(backup, password));
      await assert.rejects(
        verifyRuntimeBackupAuthentication(
          {
            ...backup,
            contractAddress: sampleContractAddress(),
          },
          password,
        ),
        /authentication failed/,
      );

      targetStore = await EncryptedPrivateStateStore.create(targetConfig, 'account-one', password);
      targetStore.provider.setContractAddress(contractAddress);
      assert.deepEqual(
        await targetStore.provider.importSigningKeys(backup.signingKeys, {
          conflictStrategy: 'error',
          maxKeys: 100,
        }),
        { imported: 1, skipped: 0, overwritten: 0 },
      );
      assert.deepEqual(
        await targetStore.provider.importPrivateStates(backup.privateStates, {
          conflictStrategy: 'error',
          maxStates: 100,
        }),
        { imported: 1, skipped: 0, overwritten: 0 },
      );
      assert.deepEqual(await targetStore.provider.get(AEQUIRA_PRIVATE_STATE_ID), privateState);
      assert.deepEqual(await targetStore.provider.getSigningKey(contractAddress), signingKey);
    } finally {
      await sourceStore?.dispose();
      await targetStore?.dispose();
      await rm(sourceDirectory, {
        force: true,
        maxRetries: 5,
        recursive: true,
        retryDelay: 50,
      });
      await rm(targetDirectory, {
        force: true,
        maxRetries: 5,
        recursive: true,
        retryDelay: 50,
      });
    }
  });
});

const readyChecks = [
  { name: 'node', ok: true, detail: 'ready' },
  { name: 'zk-assets', ok: true, detail: 'ready' },
  { name: 'proof-server', ok: true, detail: 'ready' },
];

const validCommandPrivateState = () => ({
  adminSecret: new Uint8Array(32).fill(1),
  reviewerSecret: new Uint8Array(32).fill(2),
  score: 0n,
  scoreSalt: new Uint8Array(32).fill(3),
});

const createCommandRuntime = (existingPrivateState = null, { dustBalance = 1n } = {}) => {
  const calls = [];
  let storedPrivateState = structuredClone(existingPrivateState);
  const privateStateProvider = {
    setContractAddress: () => undefined,
    get: async () => structuredClone(storedPrivateState),
    set: async (_privateStateId, value) => {
      storedPrivateState = structuredClone(value);
      calls.push('set-private-state');
    },
  };
  const runtime = {
    providers: { privateStateProvider },
    wallet: {
      start: async () => calls.push('start'),
      waitForSync: async () => calls.push('sync'),
      waitForFundingState: async () => {
        calls.push('funding');
        return {
          dustBalance,
          nightBalance: 0n,
        };
      },
    },
    close: async () => calls.push('close'),
  };

  return {
    calls,
    getStoredPrivateState: () => structuredClone(storedPrivateState),
    runtime,
  };
};

const finalizedPublicData = {
  txId: 'tx-id-1',
  txHash: 'tx-hash-1',
  blockHeight: 42,
};

const runtimeBackupFixture = (contractAddress = sampleContractAddress()) => ({
  format: 'aequira-runtime-backup',
  version: 2,
  network: 'preprod',
  contractAddress,
  createdAt: '2026-07-30T00:00:00.000Z',
  privateStates: {
    format: 'midnight-private-state-export',
    encryptedPayload: 'encrypted-private-state',
    salt: '11'.repeat(32),
  },
  signingKeys: {
    format: 'midnight-signing-key-export',
    encryptedPayload: 'encrypted-signing-keys',
    salt: '22'.repeat(32),
  },
  authentication: {
    algorithm: 'scrypt-hmac-sha256',
    salt: '33'.repeat(32),
    tag: '44'.repeat(32),
  },
});

const createRestoreRuntime = ({ initialPrivateState = null, initialSigningKey = null } = {}) => {
  const calls = [];
  let privateState = structuredClone(initialPrivateState);
  let signingKey = initialSigningKey;
  const provider = {
    setContractAddress: () => calls.push('set-contract-address'),
    get: async () => {
      calls.push('get-private-state');
      return structuredClone(privateState);
    },
    getSigningKey: async () => {
      calls.push('get-signing-key');
      return signingKey;
    },
    importSigningKeys: async (_exportData, options) => {
      calls.push(`import-signing-keys:${options.conflictStrategy}`);
      signingKey = 'restored-signing-key';
      return { imported: 1, skipped: 0, overwritten: 0 };
    },
    importPrivateStates: async (_exportData, options) => {
      calls.push(`import-private-states:${options.conflictStrategy}`);
      privateState = validCommandPrivateState();
      return { imported: 1, skipped: 0, overwritten: 0 };
    },
  };
  const runtime = {
    providers: { privateStateProvider: provider },
    wallet: {
      start: async () => calls.push('unexpected-wallet-start'),
      waitForSync: async () => calls.push('unexpected-wallet-sync'),
    },
    close: async () => calls.push('close'),
  };

  return { calls, runtime };
};

describe('AEQUIRA CLI deployment commands', () => {
  test('stops before reading secrets when doctor reports a failure', async () => {
    let readSecrets = false;

    await assert.rejects(
      runDeployCommand(loadCliConfig({ environment: {} }), 'ab'.repeat(32), {
        runPrerequisiteChecks: async () => [{ name: 'proof-server', ok: false, detail: 'offline' }],
        readSecrets: async () => {
          readSecrets = true;
          throw new Error('must not run');
        },
      }),
      /Runtime prerequisites failed: proof-server/,
    );
    assert.equal(readSecrets, false);
  });

  test('deploys only with Dust, then backs up and clears local secrets', async () => {
    const config = loadCliConfig({ environment: {} });
    const { calls, runtime } = createCommandRuntime();
    const walletSeed = new Uint8Array(32).fill(3);
    let capturedPrivateState;
    let capturedRoundId;
    const contractAddress = sampleContractAddress();
    const result = await runDeployCommand(config, 'ab'.repeat(32), {
      runPrerequisiteChecks: async () => readyChecks,
      readSecrets: async () => ({
        privateStatePassword: 'R7!mQ2@vL9#zT4$p',
        walletSeed,
      }),
      createRuntime: async () => runtime,
      deployContract: async (_providers, options) => {
        calls.push('deploy');
        capturedPrivateState = options.privateState;
        capturedRoundId = Uint8Array.from(options.roundId);
        assert.equal(
          options.privateState.adminSecret.some((byte) => byte !== 0),
          true,
        );
        return {
          deployTxData: { public: { contractAddress } },
        };
      },
      writeBackup: async () => {
        calls.push('backup');
        return '/ignored/backup.json';
      },
    });

    assert.deepEqual(result, {
      contractAddress,
      backupPath: '/ignored/backup.json',
    });
    assert.deepEqual(calls, ['start', 'funding', 'deploy', 'backup', 'close']);
    assert.deepEqual(Array.from(capturedRoundId), Array(32).fill(0xab));
    assert.equal(
      walletSeed.every((byte) => byte === 0),
      true,
    );
    assert.equal(
      capturedPrivateState.adminSecret.every((byte) => byte === 0),
      true,
    );
    assert.equal(
      capturedPrivateState.reviewerSecret.every((byte) => byte === 0),
      true,
    );
    assert.equal(
      capturedPrivateState.scoreSalt.every((byte) => byte === 0),
      true,
    );

    const zeroDust = createCommandRuntime(null, { dustBalance: 0n });
    const zeroDustSeed = new Uint8Array(32).fill(16);
    let unexpectedDeploy = false;

    await assert.rejects(
      runDeployCommand(config, 'ab'.repeat(32), {
        runPrerequisiteChecks: async () => readyChecks,
        readSecrets: async () => ({
          privateStatePassword: 'R7!mQ2@vL9#zT4$p',
          walletSeed: zeroDustSeed,
        }),
        createRuntime: async () => zeroDust.runtime,
        deployContract: async () => {
          unexpectedDeploy = true;
          throw new Error('must not deploy');
        },
      }),
      /run register-dust, then confirm funding-status/,
    );
    assert.equal(unexpectedDeploy, false);
    assert.deepEqual(zeroDust.calls, ['start', 'funding', 'close']);
    assert.equal(
      zeroDustSeed.every((byte) => byte === 0),
      true,
    );
  });

  test('reports a deployed address when its encrypted backup fails', async () => {
    const config = loadCliConfig({ environment: {} });
    const { calls, runtime } = createCommandRuntime();
    const walletSeed = new Uint8Array(32).fill(6);
    const contractAddress = sampleContractAddress();

    await assert.rejects(
      runDeployCommand(config, 'ab'.repeat(32), {
        runPrerequisiteChecks: async () => readyChecks,
        readSecrets: async () => ({
          privateStatePassword: 'R7!mQ2@vL9#zT4$p',
          walletSeed,
        }),
        createRuntime: async () => runtime,
        deployContract: async () => {
          calls.push('deploy');
          return {
            deployTxData: { public: { contractAddress } },
          };
        },
        writeBackup: async () => {
          calls.push('backup');
          throw new Error('/local/private-state/backup failed');
        },
      }),
      (error) =>
        error instanceof DeploymentBackupError &&
        error.contractAddress === contractAddress &&
        error.message.includes('Do not deploy again') &&
        !error.message.includes('/local/private-state'),
    );

    assert.deepEqual(calls, ['start', 'funding', 'deploy', 'backup', 'close']);
    assert.equal(
      walletSeed.every((byte) => byte === 0),
      true,
    );
  });

  test('joins without overwriting existing private state', async () => {
    const config = loadCliConfig({ environment: {} });
    const existing = validCommandPrivateState();
    const { calls, runtime } = createCommandRuntime(existing);
    const walletSeed = new Uint8Array(32).fill(4);
    const contractAddress = sampleContractAddress();
    let joinOptions;
    const result = await runJoinCommand(config, contractAddress, {
      runPrerequisiteChecks: async () => readyChecks,
      readSecrets: async () => ({
        privateStatePassword: 'R7!mQ2@vL9#zT4$p',
        walletSeed,
      }),
      createRuntime: async () => runtime,
      joinContract: async (_providers, options) => {
        calls.push('join');
        joinOptions = options;
        return {};
      },
      writeBackup: async () => {
        calls.push('backup');
        return '/ignored/join-backup.json';
      },
    });

    assert.equal(result.initializedPrivateState, false);
    assert.match(result.reviewerId, /^[0-9a-f]{64}$/);
    assert.deepEqual(joinOptions, { contractAddress });
    assert.deepEqual(calls, ['start', 'sync', 'join', 'backup', 'close']);
    assert.equal(
      walletSeed.every((byte) => byte === 0),
      true,
    );
  });

  test('initializes and clears private state for a first-time join', async () => {
    const config = loadCliConfig({ environment: {} });
    const { runtime } = createCommandRuntime();
    const contractAddress = sampleContractAddress();
    let initialPrivateState;
    const result = await runJoinCommand(config, contractAddress, {
      runPrerequisiteChecks: async () => readyChecks,
      readSecrets: async () => ({
        privateStatePassword: 'R7!mQ2@vL9#zT4$p',
        walletSeed: new Uint8Array(32).fill(5),
      }),
      createRuntime: async () => runtime,
      joinContract: async (_providers, options) => {
        initialPrivateState = options.initialPrivateState;
        return {};
      },
      writeBackup: async () => '/ignored/first-join.json',
    });

    assert.equal(result.initializedPrivateState, true);
    assert.match(result.reviewerId, /^[0-9a-f]{64}$/);
    assert.equal(
      initialPrivateState.reviewerSecret.every((byte) => byte === 0),
      true,
    );
  });
});

describe('AEQUIRA CLI backup restoration', () => {
  test('restores encrypted state and signing keys without network startup', async () => {
    const { calls, runtime } = createRestoreRuntime();
    const walletSeed = new Uint8Array(32).fill(8);
    const backup = runtimeBackupFixture();
    const result = await runRestoreCommand(
      loadCliConfig({ environment: {} }),
      '/ignored/backup.json',
      {
        readBackup: async () => backup,
        verifyBackup: async () => undefined,
        readSecrets: async () => ({
          privateStatePassword: 'R7!mQ2@vL9#zT4$p',
          walletSeed,
        }),
        createRuntime: async () => runtime,
      },
    );

    assert.deepEqual(result, {
      contractAddress: backup.contractAddress,
      restoredPrivateStates: 1,
      restoredSigningKeys: 1,
      reviewerId: result.reviewerId,
    });
    assert.match(result.reviewerId, /^[0-9a-f]{64}$/);
    assert.deepEqual(calls, [
      'set-contract-address',
      'get-private-state',
      'get-signing-key',
      'import-signing-keys:error',
      'import-private-states:error',
      'get-private-state',
      'get-signing-key',
      'close',
    ]);
    assert.equal(
      walletSeed.every((byte) => byte === 0),
      true,
    );
  });

  test('refuses to overwrite existing private state', async () => {
    const { calls, runtime } = createRestoreRuntime({
      initialPrivateState: validCommandPrivateState(),
    });
    const walletSeed = new Uint8Array(32).fill(9);

    await assert.rejects(
      runRestoreCommand(loadCliConfig({ environment: {} }), '/ignored/backup.json', {
        readBackup: async () => runtimeBackupFixture(),
        verifyBackup: async () => undefined,
        readSecrets: async () => ({
          privateStatePassword: 'R7!mQ2@vL9#zT4$p',
          walletSeed,
        }),
        createRuntime: async () => runtime,
      }),
      /refusing to overwrite/,
    );

    assert.equal(
      calls.some((call) => call.startsWith('import-')),
      false,
    );
    assert.equal(calls.at(-1), 'close');
    assert.equal(
      walletSeed.every((byte) => byte === 0),
      true,
    );
  });

  test('rejects a network mismatch before reading secrets', async () => {
    let readSecrets = false;

    await assert.rejects(
      runRestoreCommand(
        loadCliConfig({ environment: {}, network: 'preview' }),
        '/ignored/backup.json',
        {
          readBackup: async () => runtimeBackupFixture(),
          readSecrets: async () => {
            readSecrets = true;
            throw new Error('must not run');
          },
        },
      ),
      /does not match configured network/,
    );
    assert.equal(readSecrets, false);
  });
});

describe('AEQUIRA CLI administrator commands', () => {
  test('registers a public reviewer pseudonym with the stored admin state', async () => {
    const { calls, runtime } = createCommandRuntime(validCommandPrivateState());
    const contractAddress = sampleContractAddress();
    let capturedReviewerId;
    const result = await runRegisterReviewerCommand(
      loadCliConfig({ environment: {} }),
      contractAddress,
      'ef'.repeat(32),
      {
        runPrerequisiteChecks: async () => readyChecks,
        readSecrets: async () => ({
          privateStatePassword: 'R7!mQ2@vL9#zT4$p',
          walletSeed: new Uint8Array(32).fill(6),
        }),
        createRuntime: async () => runtime,
        joinContract: async () => ({
          callTx: {
            registerReviewer: async (reviewerId) => {
              calls.push('register-reviewer');
              capturedReviewerId = Uint8Array.from(reviewerId);
              return { public: finalizedPublicData };
            },
          },
        }),
        writeBackup: async () => {
          calls.push('backup');
          return '/ignored/register-reviewer.json';
        },
      },
    );

    assert.deepEqual(Array.from(capturedReviewerId), Array(32).fill(0xef));
    assert.equal(result.transactionId, 'tx-id-1');
    assert.deepEqual(calls, ['start', 'funding', 'register-reviewer', 'backup', 'close']);
  });

  test('maps each phase command to its exact contract circuit', async () => {
    const cases = [
      ['open-applications', 'openApplications'],
      ['open-review', 'openReview'],
      ['open-reveal', 'openReveal'],
    ];

    for (const [command, circuit] of cases) {
      const { calls, runtime } = createCommandRuntime(validCommandPrivateState());

      await runPhaseCommand(loadCliConfig({ environment: {} }), sampleContractAddress(), command, {
        runPrerequisiteChecks: async () => readyChecks,
        readSecrets: async () => ({
          privateStatePassword: 'R7!mQ2@vL9#zT4$p',
          walletSeed: new Uint8Array(32).fill(6),
        }),
        createRuntime: async () => runtime,
        joinContract: async () => ({
          callTx: {
            [circuit]: async () => {
              calls.push(circuit);
              return { public: finalizedPublicData };
            },
          },
        }),
        writeBackup: async () => {
          calls.push('backup');
          return `/ignored/${command}.json`;
        },
      });

      assert.deepEqual(calls, ['start', 'funding', circuit, 'backup', 'close']);
    }
  });
});

describe('AEQUIRA CLI score commands', () => {
  test('commits a masked score, persists its fresh salt, and returns only public tx data', async () => {
    const privateState = {
      adminSecret: new Uint8Array(32).fill(1),
      reviewerSecret: new Uint8Array(32).fill(2),
      score: 0n,
      scoreSalt: new Uint8Array(32).fill(3),
    };
    const { calls, getStoredPrivateState, runtime } = createCommandRuntime(privateState);
    const walletSeed = new Uint8Array(32).fill(7);
    const contractAddress = sampleContractAddress();
    let capturedApplicationId;
    const result = await runCommitScoreCommand(
      loadCliConfig({ environment: {} }),
      contractAddress,
      'ab'.repeat(32),
      {
        runPrerequisiteChecks: async () => readyChecks,
        readSecrets: async () => ({
          privateStatePassword: 'R7!mQ2@vL9#zT4$p',
          walletSeed,
        }),
        promptSecret: async () => '87',
        createRuntime: async () => runtime,
        joinContract: async () => ({
          callTx: {
            commitScore: async (applicationId) => {
              calls.push('commit-score');
              capturedApplicationId = Uint8Array.from(applicationId);
              return { public: finalizedPublicData };
            },
          },
        }),
        writeBackup: async () => {
          calls.push('backup');
          return '/ignored/commit-score.json';
        },
      },
    );

    assert.deepEqual(result, {
      contractAddress,
      transactionId: 'tx-id-1',
      transactionHash: 'tx-hash-1',
      blockHeight: 42,
      backupPath: '/ignored/commit-score.json',
    });
    assert.deepEqual(Array.from(capturedApplicationId), Array(32).fill(0xab));
    assert.equal(getStoredPrivateState().score, 87n);
    assert.equal(
      getStoredPrivateState().scoreSalt.some((byte) => byte !== 0),
      true,
    );
    assert.deepEqual(calls, [
      'start',
      'funding',
      'set-private-state',
      'commit-score',
      'backup',
      'close',
    ]);
    assert.equal(
      walletSeed.every((byte) => byte === 0),
      true,
    );
    assert.deepEqual(Object.keys(result).sort(), [
      'backupPath',
      'blockHeight',
      'contractAddress',
      'transactionHash',
      'transactionId',
    ]);
  });

  test('reveals the score already stored in encrypted private state', async () => {
    const privateState = {
      adminSecret: new Uint8Array(32).fill(1),
      reviewerSecret: new Uint8Array(32).fill(2),
      score: 87n,
      scoreSalt: new Uint8Array(32).fill(3),
    };
    const { calls, runtime } = createCommandRuntime(privateState);
    const walletSeed = new Uint8Array(32).fill(8);
    const contractAddress = sampleContractAddress();
    const result = await runRevealScoreCommand(
      loadCliConfig({ environment: {} }),
      contractAddress,
      'cd'.repeat(32),
      {
        runPrerequisiteChecks: async () => readyChecks,
        readSecrets: async () => ({
          privateStatePassword: 'R7!mQ2@vL9#zT4$p',
          walletSeed,
        }),
        createRuntime: async () => runtime,
        joinContract: async () => ({
          callTx: {
            revealScore: async (applicationId) => {
              calls.push('reveal-score');
              assert.deepEqual(Array.from(applicationId), Array(32).fill(0xcd));
              return { public: finalizedPublicData };
            },
          },
        }),
        writeBackup: async () => {
          calls.push('backup');
          return '/ignored/reveal-score.json';
        },
      },
    );

    assert.equal(result.transactionId, 'tx-id-1');
    assert.deepEqual(calls, ['start', 'funding', 'reveal-score', 'backup', 'close']);
    assert.equal(
      walletSeed.every((byte) => byte === 0),
      true,
    );
  });

  test('does not submit a score call without local private state', async () => {
    const { calls, runtime } = createCommandRuntime();
    const contractAddress = sampleContractAddress();

    await assert.rejects(
      runRevealScoreCommand(loadCliConfig({ environment: {} }), contractAddress, 'cd'.repeat(32), {
        runPrerequisiteChecks: async () => readyChecks,
        readSecrets: async () => ({
          privateStatePassword: 'R7!mQ2@vL9#zT4$p',
          walletSeed: new Uint8Array(32).fill(9),
        }),
        createRuntime: async () => runtime,
        joinContract: async () => ({
          callTx: {
            revealScore: async () => {
              calls.push('must-not-submit');
              return { public: finalizedPublicData };
            },
          },
        }),
      }),
      /run join before submitting a contract call/,
    );
    assert.equal(calls.includes('must-not-submit'), false);
    assert.equal(calls.at(-1), 'close');
  });

  test('preserves finalized call identity when backup creation fails', async () => {
    const privateState = {
      adminSecret: new Uint8Array(32).fill(1),
      reviewerSecret: new Uint8Array(32).fill(2),
      score: 87n,
      scoreSalt: new Uint8Array(32).fill(3),
    };
    const { runtime } = createCommandRuntime(privateState);
    const contractAddress = sampleContractAddress();

    await assert.rejects(
      runRevealScoreCommand(loadCliConfig({ environment: {} }), contractAddress, 'cd'.repeat(32), {
        runPrerequisiteChecks: async () => readyChecks,
        readSecrets: async () => ({
          privateStatePassword: 'R7!mQ2@vL9#zT4$p',
          walletSeed: new Uint8Array(32).fill(9),
        }),
        createRuntime: async () => runtime,
        joinContract: async () => ({
          callTx: {
            revealScore: async () => ({ public: finalizedPublicData }),
          },
        }),
        writeBackup: async () => {
          throw new Error('/local/private-state/backup failed');
        },
      }),
      (error) =>
        error instanceof FinalizedCallBackupError &&
        error.transactionId === 'tx-id-1' &&
        error.message.includes('Do not submit the call again') &&
        !error.message.includes('/local/private-state'),
    );
  });
});

describe('AEQUIRA CLI wallet provider', () => {
  test('creates a project-only encrypted development wallet without printing its seed', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'aequira-wallet-create-'));
    const config = loadCliConfig({
      environment: { AEQUIRA_PRIVATE_STATE_DIR: directory },
      network: 'preprod',
    });
    const walletPassword = 'V9!qR2@mL7#xT4$p';
    const generatedSeed = new Uint8Array(32).fill(11);
    const expectedSeed = Uint8Array.from(generatedSeed);
    const labels = [];
    const answers = [walletPassword, walletPassword];

    try {
      const result = await runWalletCreateCommand(config, {
        generateWalletSeed: () => generatedSeed,
        promptSecret: async (label) => {
          labels.push(label);
          return answers.shift();
        },
      });

      assert.equal(result.network, 'preprod');
      assert.match(result.unshieldedAddress, /^mn_addr_preprod1/);
      assert.equal(result.vaultPath, getWalletVaultPath(config));
      assert.deepEqual(labels, [
        'New development-wallet password: ',
        'Confirm development-wallet password: ',
      ]);
      assert.equal(
        generatedSeed.every((byte) => byte === 0),
        true,
      );
      assert.equal(
        JSON.stringify(result).includes(Buffer.from(expectedSeed).toString('hex')),
        false,
      );

      const restoredSeed = await readWalletVault(config, walletPassword);
      assert.deepEqual(Array.from(restoredSeed), Array.from(expectedSeed));
      restoredSeed.fill(0);
    } finally {
      expectedSeed.fill(0);
      await rm(directory, { force: true, recursive: true });
    }
  });

  test('derives network-specific public funding addresses offline and clears each seed', async () => {
    for (const [network, prefix] of [
      ['preview', 'mn_addr_preview1'],
      ['preprod', 'mn_addr_preprod1'],
    ]) {
      const seed = new Uint8Array(32).fill(6);
      const result = await runWalletAddressCommand(loadCliConfig({ environment: {}, network }), {
        readWalletSeed: async () => seed,
      });

      assert.equal(result.network, network);
      assert.match(result.unshieldedAddress, new RegExp(`^${prefix}`));
      assert.equal(
        seed.every((byte) => byte === 0),
        true,
      );
    }
  });

  test('reports public funding state and closes the network wallet', async () => {
    const seed = new Uint8Array(32).fill(8);
    let startCalls = 0;
    let stopCalls = 0;
    const result = await runFundingStatusCommand(
      loadCliConfig({ environment: {}, network: 'preprod' }),
      {
        readWalletSeed: async () => seed,
        createWalletProvider: async (_config, suppliedSeed) => {
          assert.equal(suppliedSeed, seed);

          return {
            accountId: 'mn_addr_preprod1public',
            start: async () => {
              startCalls += 1;
            },
            waitForFundingState: async () => ({
              dustBalance: 17n,
              nightBalance: 1_000_000_000n,
            }),
            stop: async () => {
              stopCalls += 1;
            },
          };
        },
      },
    );

    assert.deepEqual(result, {
      dustBalance: '17',
      hasDust: true,
      network: 'preprod',
      nightBalance: '1000000000',
      unshieldedAddress: 'mn_addr_preprod1public',
    });
    assert.equal(startCalls, 1);
    assert.equal(stopCalls, 1);
    assert.equal(
      seed.every((byte) => byte === 0),
      true,
    );

    const registrationSeed = new Uint8Array(32).fill(13);
    let registrationStopCalls = 0;
    const registration = await runRegisterDustCommand(
      loadCliConfig({ environment: {}, network: 'preview' }),
      {
        readWalletSeed: async () => registrationSeed,
        createWalletProvider: async () => ({
          accountId: 'mn_addr_preview1public',
          start: async () => undefined,
          registerAvailableNightForDust: async () => ({
            dustBalanceBefore: 0n,
            registeredUtxos: 2,
            transactionId: 'dust-tx-1',
          }),
          stop: async () => {
            registrationStopCalls += 1;
          },
        }),
      },
    );

    assert.deepEqual(registration, {
      dustBalanceBefore: '0',
      network: 'preview',
      registeredUtxos: 2,
      submitted: true,
      transactionId: 'dust-tx-1',
      unshieldedAddress: 'mn_addr_preview1public',
    });
    assert.equal(registrationStopCalls, 1);
    assert.equal(
      registrationSeed.every((byte) => byte === 0),
      true,
    );

    const noOpSeed = new Uint8Array(32).fill(15);
    const noOpRegistration = await runRegisterDustCommand(loadCliConfig({ environment: {} }), {
      readWalletSeed: async () => noOpSeed,
      createWalletProvider: async () => ({
        accountId: 'mn_addr_preprod1public',
        start: async () => undefined,
        registerAvailableNightForDust: async () => ({
          dustBalanceBefore: 29n,
          registeredUtxos: 0,
          transactionId: null,
        }),
        stop: async () => undefined,
      }),
    });
    assert.equal(noOpRegistration.submitted, false);
    assert.equal(noOpRegistration.transactionId, null);
    assert.equal(
      noOpSeed.every((byte) => byte === 0),
      true,
    );

    const cleanupFailureSeed = new Uint8Array(32).fill(14);
    await assert.rejects(
      runRegisterDustCommand(loadCliConfig({ environment: {} }), {
        readWalletSeed: async () => cleanupFailureSeed,
        createWalletProvider: async () => ({
          accountId: 'mn_addr_preprod1public',
          start: async () => undefined,
          registerAvailableNightForDust: async () => ({
            dustBalanceBefore: 0n,
            registeredUtxos: 1,
            transactionId: 'submitted-dust-tx',
          }),
          stop: async () => {
            throw new Error('stop failed');
          },
        }),
      }),
      (error) =>
        error instanceof DustRegistrationCleanupError &&
        error.transactionId === 'submitted-dust-tx' &&
        error.message.includes('Do not submit the registration again'),
    );
    assert.equal(
      cleanupFailureSeed.every((byte) => byte === 0),
      true,
    );
  });

  test('cleans up funding-status secrets and wallet after synchronization failure', async () => {
    const seed = new Uint8Array(32).fill(10);
    let stopCalls = 0;

    await assert.rejects(
      runFundingStatusCommand(loadCliConfig({ environment: {} }), {
        readWalletSeed: async () => seed,
        createWalletProvider: async () => ({
          accountId: 'mn_addr_preprod1public',
          start: async () => undefined,
          waitForFundingState: async () => {
            throw new Error('sync failed');
          },
          stop: async () => {
            stopCalls += 1;
          },
        }),
      }),
      /sync failed/,
    );

    assert.equal(stopCalls, 1);
    assert.equal(
      seed.every((byte) => byte === 0),
      true,
    );
  });

  test('derives a public account and consumes the supplied wallet seed', async () => {
    const config = loadCliConfig({ environment: {} });
    const seed = new Uint8Array(32).fill(7);
    let stopCalls = 0;
    let dustRegistrationCalls = 0;
    let dustSubmissionCalls = 0;
    let nightRegistered = false;
    const nightToken = unshieldedToken().raw;
    const availableCoins = () => [
      {
        utxo: { type: nightToken },
        meta: { registeredForDustGeneration: nightRegistered },
      },
      {
        utxo: { type: nightToken },
        meta: { registeredForDustGeneration: true },
      },
      {
        utxo: { type: 'other-token' },
        meta: { registeredForDustGeneration: false },
      },
    ];
    const wallet = await AequiraWalletProvider.create(config, seed, {
      createWallet: async () => ({
        start: async () => undefined,
        waitForSyncedState: async () => ({
          dust: {
            address: 'mn_dust_preprod1public',
            balance: () => 23n,
          },
          unshielded: {
            availableCoins: availableCoins(),
            balances: {
              [nightToken]: 31n,
            },
          },
        }),
        registerNightUtxosForDustGeneration: async (utxos) => {
          dustRegistrationCalls += 1;
          assert.equal(utxos.length, 1);
          assert.equal(utxos[0].utxo.type, nightToken);
          return { type: 'UNPROVEN_TRANSACTION' };
        },
        finalizeRecipe: async () => ({ finalized: true }),
        submitTransaction: async () => {
          dustSubmissionCalls += 1;
          nightRegistered = true;
          return 'dust-tx-2';
        },
        stop: async () => {
          stopCalls += 1;
        },
      }),
    });

    try {
      assert.equal(
        seed.every((byte) => byte === 0),
        true,
      );
      assert.match(wallet.accountId, /^mn_addr_preprod1/);
      assert.equal(wallet.getCoinPublicKey().length > 0, true);
      await wallet.start();
      assert.deepEqual(await wallet.waitForFundingState(), {
        dustBalance: 23n,
        nightBalance: 31n,
      });
      assert.deepEqual(await wallet.registerAvailableNightForDust(), {
        dustBalanceBefore: 23n,
        registeredUtxos: 1,
        transactionId: 'dust-tx-2',
      });
      assert.deepEqual(await wallet.registerAvailableNightForDust(), {
        dustBalanceBefore: 23n,
        registeredUtxos: 0,
        transactionId: null,
      });
      assert.equal(dustRegistrationCalls, 1);
      assert.equal(dustSubmissionCalls, 1);
    } finally {
      await wallet.stop();
    }

    assert.equal(stopCalls, 1);
    assert.throws(() => wallet.getCoinPublicKey(), /secret keys are no longer available/);
  });

  test('clears malformed seed input after rejecting it', async () => {
    const config = loadCliConfig({ environment: {} });
    const seed = new Uint8Array(31).fill(9);

    await assert.rejects(AequiraWalletProvider.create(config, seed), /exactly 32 bytes/);
    assert.equal(
      seed.every((byte) => byte === 0),
      true,
    );

    const initializationSeed = new Uint8Array(32).fill(11);
    await assert.rejects(
      AequiraWalletProvider.create(config, initializationSeed, {
        createWallet: async () => {
          throw new Error('wallet initialization failed');
        },
      }),
      /wallet initialization failed/,
    );
    assert.equal(
      initializationSeed.every((byte) => byte === 0),
      true,
    );
  });
});
