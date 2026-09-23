import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { describe, test } from 'node:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AEQUIRA_PRIVATE_STATE_ID,
  deriveApplicantId,
  deriveApplicantLeaf,
  deriveApplicationNonce,
  deriveApplicationPseudonym,
  deriveApplyNullifier,
  deriveScoreCommitment,
  deriveScoreNullifier,
  deriveScoreSalt,
  issueEnrollmentReceipt,
  openEnrollmentReceipt,
} from '@aequira/sdk';
import {
  sampleContractAddress,
  sampleSigningKey,
} from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { MidnightBech32m } from '@midnight-ntwrk/wallet-sdk';
import {
  AequiraWalletProvider,
  DeploymentBackupError,
  DustRegistrationCleanupError,
  EncryptedPrivateStateStore,
  EnrollmentBackupError,
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
  runApplyCommand,
  runCommitScoreCommand,
  runDeployCommand,
  runDoctor,
  runFundingStatusCommand,
  runImportEnrollmentCommand,
  runJoinCommand,
  runPhaseCommand,
  runRegisterApplicantCommand,
  runRegisterDustCommand,
  runRegisterReviewerCommand,
  runRestoreCommand,
  runRevealScoreCommand,
  runRoundStatusCommand,
  runWalletAddressCommand,
  runWalletCreateCommand,
  toRoundStatus,
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

// Every command reads a complete private state before it calls a circuit, so
// each fixture below states only the values its own test cares about and takes
// the rest — including the whole applicant half of the round — from here.
const privateStateFixture = (overrides = {}) => ({
  adminSecret: new Uint8Array(32).fill(1),
  reviewerSecret: new Uint8Array(32).fill(2),
  score: 0n,
  scoreSalt: new Uint8Array(32).fill(3),
  applicantSecret: new Uint8Array(32).fill(4),
  applicantIncomeBand: 2n,
  applicantGpaScaled: 350n,
  applicantRegionCode: 7n,
  applicantSalt: new Uint8Array(32).fill(5),
  ...overrides,
});

const hexKey = (value) => Buffer.from(value).toString('hex');

const setOf = (values = []) => {
  const keys = new Set(values.map(hexKey));
  return {
    member: (value) => keys.has(hexKey(value)),
    size: () => BigInt(keys.size),
    *[Symbol.iterator]() {
      yield* values;
    },
  };
};

const counterMapOf = (entries = []) => {
  const counters = new Map(entries.map(([key, value]) => [hexKey(key), value]));
  return {
    member: (key) => counters.has(hexKey(key)),
    lookup: (key) => ({ read: () => counters.get(hexKey(key)) }),
  };
};

// The slice of the public ledger the commands read. Only what a test names is
// present; every set starts empty.
const ledgerFixture = ({
  roundId,
  phase = 0,
  applications = [],
  applyNullifiers = [],
  enrolledLeaves = [],
  reviewers = [],
  revealedCounts = [],
  scoreCommitments = [],
  scoreNullifiers = [],
  scoreSums = [],
} = {}) => ({
  roundId,
  phase,
  maxIncomeBand: 3n,
  minGpaScaled: 300n,
  applications: setOf(applications),
  applyNullifiers: setOf(applyNullifiers),
  reviewers: setOf(reviewers),
  scoreCommitments: setOf(scoreCommitments),
  scoreNullifiers: setOf(scoreNullifiers),
  applicantTree: {
    firstFree: () => BigInt(enrolledLeaves.length),
    findPathForLeaf: (leaf) =>
      enrolledLeaves.some((enrolled) => hexKey(enrolled) === hexKey(leaf))
        ? { leaf, path: [] }
        : undefined,
  },
  revealedCounts: counterMapOf(revealedCounts),
  scoreSums: counterMapOf(scoreSums),
});

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

  test('treats a blank setting as unset instead of as the working directory', () => {
    const defaults = loadCliConfig({ environment: {} });
    const blank = loadCliConfig({
      environment: {
        AEQUIRA_NETWORK: '',
        AEQUIRA_PRIVATE_STATE_DIR: '  ',
        AEQUIRA_PROOF_SERVER_URL: '',
      },
    });

    assert.equal(blank.privateStateDirectory, defaults.privateStateDirectory);
    assert.notEqual(blank.privateStateDirectory, process.cwd());
    assert.equal(blank.network, defaults.network);
    assert.equal(blank.proofServer, defaults.proofServer);
    assert.throws(
      () => loadCliConfig({ environment: { AEQUIRA_PROOF_SERVER_URL: 'not a url' } }),
      /proof server URL must be a valid URL/,
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

  test('never echoes an unrecognized command, argument or network', () => {
    // A mnemonic word or secret pasted into the wrong place must not reach the terminal.
    assert.throws(
      () => parseCliArguments(['abandon', 'ability']),
      (error) => /Unknown command/.test(error.message) && !error.message.includes('abandon'),
    );
    assert.throws(
      () => parseCliArguments(['doctor', '--unknown-flag=hunter2-value']),
      (error) =>
        error.message.includes('--unknown-flag') && !error.message.includes('hunter2-value'),
    );
    assert.throws(
      () => parseCliArguments(['doctor', 'zebra']),
      (error) =>
        /Unexpected argument at position 2/.test(error.message) && !error.message.includes('zebra'),
    );
    assert.throws(
      () => parseCliArguments(['doctor', 'zebra-secret-value']),
      (error) =>
        /position 2 is forbidden/.test(error.message) &&
        !error.message.includes('zebra-secret-value'),
    );
    assert.throws(
      () => loadCliConfig({ environment: {}, network: 'not-a-network-secret' }),
      (error) =>
        /Unsupported network/.test(error.message) &&
        !error.message.includes('not-a-network-secret'),
    );
  });

  test('requires public deploy and join identifiers', () => {
    assert.throws(() => parseCliArguments(['deploy']), /requires --round-id/);
    assert.throws(() => parseCliArguments(['join']), /requires --contract-address/);
    assert.throws(
      () => parseCliArguments(['deploy', '--round-id', 'ab'.repeat(32)]),
      /requires --max-income-band/,
    );
    assert.throws(
      () => parseCliArguments(['deploy', '--round-id', 'ab'.repeat(32), '--max-income-band', '3']),
      /requires --min-gpa-scaled/,
    );
    assert.throws(
      () => parseCliArguments(['join', '--max-income-band', '3']),
      /--max-income-band is only valid with deploy/,
    );
    assert.deepEqual(
      parseCliArguments([
        'deploy',
        '--round-id',
        'ab'.repeat(32),
        '--max-income-band',
        '3',
        '--min-gpa-scaled',
        '300',
      ]),
      {
        command: 'deploy',
        json: false,
        maxIncomeBand: '3',
        minGpaScaled: '300',
        roundId: 'ab'.repeat(32),
      },
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
    assert.throws(
      () =>
        parseCliArguments(['register-applicant', '--contract-address', sampleContractAddress()]),
      /requires --applicant-id/,
    );
    assert.throws(
      () => parseCliArguments(['register-applicant', '--applicant-id', 'ab'.repeat(32)]),
      /requires --contract-address/,
    );
    assert.throws(
      () =>
        parseCliArguments([
          'join',
          '--contract-address',
          sampleContractAddress(),
          '--applicant-id',
          'ab'.repeat(32),
        ]),
      /--applicant-id is only valid with register-applicant/,
    );
    assert.throws(() => parseCliArguments(['enroll-applicant']), /Unknown command/);
    assert.deepEqual(
      parseCliArguments([
        'register-dust',
        '--dust-address',
        'mn_dust_preprod1wwccv5pa0c4flstyp0vwtyn68s046p4cujfhegh36evqu77yjylj5ke532j',
      ]),
      {
        command: 'register-dust',
        dustAddress: 'mn_dust_preprod1wwccv5pa0c4flstyp0vwtyn68s046p4cujfhegh36evqu77yjylj5ke532j',
        json: false,
      },
    );
    assert.throws(
      () => parseCliArguments(['funding-status', '--dust-address', 'mn_dust_preprod1abc']),
      /--dust-address is only valid with register-dust/,
    );
    assert.throws(
      () => parseCliArguments(['register-dust', '--dust-address']),
      /--dust-address requires a value/,
    );
    const applicantContractAddress = sampleContractAddress();
    assert.deepEqual(
      parseCliArguments([
        'register-applicant',
        '--contract-address',
        applicantContractAddress,
        '--applicant-id',
        'ab'.repeat(32),
      ]),
      {
        command: 'register-applicant',
        json: false,
        applicantId: 'ab'.repeat(32),
        contractAddress: applicantContractAddress,
      },
    );
    assert.throws(() => parseCliArguments(['import-enrollment']), /requires --contract-address/);
    assert.equal(
      parseCliArguments(['import-enrollment', '--contract-address', sampleContractAddress()])
        .command,
      'import-enrollment',
    );
    assert.throws(() => parseCliArguments(['round-status']), /requires --contract-address/);
    assert.equal(
      parseCliArguments(['round-status', '--contract-address', sampleContractAddress()]).command,
      'round-status',
    );
    assert.throws(() => parseCliArguments(['apply']), /requires --contract-address/);
    assert.equal(
      parseCliArguments(['apply', '--contract-address', sampleContractAddress()]).command,
      'apply',
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

    // A server that answers with 5xx is reachable but not working.
    const serverError = await runDoctor(config, {
      accessFile: async () => undefined,
      fetchUrl: async (url) => new Response(null, { status: url === config.indexer ? 503 : 200 }),
      nodeVersion: '24.11.1',
    });
    assert.equal(serverError.find(({ name }) => name === 'indexer')?.ok, false);
    assert.equal(serverError.find(({ name }) => name === 'proof-server')?.ok, true);
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

  test('refuses a mistyped storage password before it can write unreadable entries', async () => {
    // A wrong password used to open the store anyway, and everything written
    // under it was unreadable with the real one and broke every later backup.
    const directory = await mkdtemp(path.join(tmpdir(), 'aequira-private-state-'));
    const config = loadCliConfig({
      environment: { AEQUIRA_PRIVATE_STATE_DIR: directory },
    });
    const password = 'R7!mQ2@vL9#zT4$p';
    const contractAddress = sampleContractAddress();
    let store;

    try {
      store = await EncryptedPrivateStateStore.create(config, 'account-one', password);
      await store.provider.setSigningKey(contractAddress, 'ab'.repeat(32));
      await store.dispose();
      store = undefined;

      await assert.rejects(
        EncryptedPrivateStateStore.create(config, 'account-one', 'W8@kP3#nV6!cR2$x'),
        /does not open the existing store/,
      );

      store = await EncryptedPrivateStateStore.create(config, 'account-one', password);
      assert.equal(await store.provider.getSigningKey(contractAddress), 'ab'.repeat(32));
    } finally {
      await store?.dispose();
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
    const privateState = privateStateFixture({ score: 73n });
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

const validCommandPrivateState = () => privateStateFixture();

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

// Models the Level provider's import semantics: a signing-key export carries
// every key of the account, so a store that already holds another round's key
// conflicts under 'error' and skips it under 'skip'.
const createRestoreRuntime = ({
  initialPrivateState = null,
  initialSigningKey = null,
  otherRoundKey = false,
  backupHasTargetKey = true,
} = {}) => {
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
      if (otherRoundKey && options.conflictStrategy === 'error') {
        throw new Error('Import conflict: 1 signing key already exists');
      }
      if (backupHasTargetKey) {
        signingKey = 'restored-signing-key';
      }
      return {
        imported: backupHasTargetKey ? 1 : 0,
        skipped: otherRoundKey ? 1 : 0,
        overwritten: 0,
      };
    },
    importPrivateStates: async (_exportData, options) => {
      calls.push(`import-private-states:${options.conflictStrategy}`);
      privateState = validCommandPrivateState();
      return { imported: 1, skipped: 0, overwritten: 0 };
    },
    remove: async () => {
      calls.push('remove-private-state');
      privateState = null;
    },
    removeSigningKey: async () => {
      calls.push('remove-signing-key');
      signingKey = null;
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
      runDeployCommand(loadCliConfig({ environment: {} }), 'ab'.repeat(32), '3', '300', {
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
    let capturedThresholds;
    const contractAddress = sampleContractAddress();
    const result = await runDeployCommand(config, 'ab'.repeat(32), '3', '300', {
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
        capturedThresholds = {
          maxIncomeBand: options.maxIncomeBand,
          minGpaScaled: options.minGpaScaled,
        };
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
    assert.equal(
      capturedPrivateState.applicantSecret.every((byte) => byte === 0),
      true,
    );
    assert.equal(
      capturedPrivateState.applicantSalt.every((byte) => byte === 0),
      true,
    );
    assert.equal(capturedThresholds.maxIncomeBand, 3n);
    assert.equal(capturedThresholds.minGpaScaled, 300n);

    const zeroDust = createCommandRuntime(null, { dustBalance: 0n });
    const zeroDustSeed = new Uint8Array(32).fill(16);
    let unexpectedDeploy = false;

    await assert.rejects(
      runDeployCommand(config, 'ab'.repeat(32), '3', '300', {
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

  test('refuses a threshold the contract could not store, before opening a wallet', async () => {
    const config = loadCliConfig({ environment: {} });
    let touchedPrerequisites = false;

    await assert.rejects(
      runDeployCommand(config, 'ab'.repeat(32), '256', '300', {
        runPrerequisiteChecks: async () => {
          touchedPrerequisites = true;
          return readyChecks;
        },
      }),
      /Maximum income band must be a whole number between 0 and 255/,
    );
    assert.equal(touchedPrerequisites, false);
  });

  test('reports a deployed address when its encrypted backup fails', async () => {
    const config = loadCliConfig({ environment: {} });
    const { calls, runtime } = createCommandRuntime();
    const walletSeed = new Uint8Array(32).fill(6);
    const contractAddress = sampleContractAddress();

    await assert.rejects(
      runDeployCommand(config, 'ab'.repeat(32), '3', '300', {
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

  test('keeps the real outcome when the runtime fails to close', async () => {
    // By the time close runs the contract may already be deployed; reporting a
    // failure instead would invite a duplicate deployment.
    const config = loadCliConfig({ environment: {} });
    const contractAddress = sampleContractAddress();
    const warnings = [];
    const failingClose = (runtime) => {
      runtime.close = async () => {
        throw new Error('close failed at /local/private-state');
      };
      return runtime;
    };
    const dependencies = (runtime, overrides = {}) => ({
      runPrerequisiteChecks: async () => readyChecks,
      readSecrets: async () => ({
        privateStatePassword: 'R7!mQ2@vL9#zT4$p',
        walletSeed: new Uint8Array(32).fill(3),
      }),
      createRuntime: async () => failingClose(runtime),
      deployContract: async () => ({ deployTxData: { public: { contractAddress } } }),
      writeBackup: async () => '/ignored/backup.json',
      reportCleanupWarning: (message) => warnings.push(message),
      ...overrides,
    });

    const result = await runDeployCommand(
      config,
      'ab'.repeat(32),
      '3',
      '300',
      dependencies(createCommandRuntime().runtime),
    );

    assert.equal(result.contractAddress, contractAddress);
    assert.equal(warnings.length, 1);
    assert.doesNotMatch(warnings[0], /\/local\//);

    await assert.rejects(
      runDeployCommand(
        config,
        'ab'.repeat(32),
        '3',
        '300',
        dependencies(createCommandRuntime(null, { dustBalance: 0n }).runtime),
      ),
      /run register-dust, then confirm funding-status/,
    );
    assert.equal(warnings.length, 2);
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
    assert.equal(result.applicantId, hexKey(deriveApplicantId(existing.applicantSecret)));
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
    let saltAtJoin;
    let applicantSecretAtJoin;
    const result = await runJoinCommand(config, contractAddress, {
      runPrerequisiteChecks: async () => readyChecks,
      readSecrets: async () => ({
        privateStatePassword: 'R7!mQ2@vL9#zT4$p',
        walletSeed: new Uint8Array(32).fill(5),
      }),
      createRuntime: async () => runtime,
      joinContract: async (_providers, options) => {
        initialPrivateState = options.initialPrivateState;
        saltAtJoin = Uint8Array.from(options.initialPrivateState.applicantSalt);
        applicantSecretAtJoin = Uint8Array.from(options.initialPrivateState.applicantSecret);
        return {};
      },
      writeBackup: async () => '/ignored/first-join.json',
    });

    assert.equal(result.initializedPrivateState, true);
    assert.match(result.reviewerId, /^[0-9a-f]{64}$/);
    // No receipt yet: the salt stays zero while the applicant secret is random.
    assert.equal(
      saltAtJoin.every((byte) => byte === 0),
      true,
    );
    assert.equal(
      applicantSecretAtJoin.some((byte) => byte !== 0),
      true,
    );
    assert.equal(result.applicantId, hexKey(deriveApplicantId(applicantSecretAtJoin)));
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
      applicantId: hexKey(deriveApplicantId(validCommandPrivateState().applicantSecret)),
      contractAddress: backup.contractAddress,
      restoredPrivateStates: 1,
      restoredSigningKeys: 1,
      reviewerId: result.reviewerId,
      skippedSigningKeys: 0,
    });
    assert.match(result.reviewerId, /^[0-9a-f]{64}$/);
    assert.deepEqual(calls, [
      'set-contract-address',
      'get-private-state',
      'get-signing-key',
      'import-private-states:error',
      'get-private-state',
      'import-signing-keys:skip',
      'get-signing-key',
      'close',
    ]);
    assert.equal(
      walletSeed.every((byte) => byte === 0),
      true,
    );
  });

  const restoreDependencies = (runtime) => ({
    readBackup: async () => runtimeBackupFixture(),
    verifyBackup: async () => undefined,
    readSecrets: async () => ({
      privateStatePassword: 'R7!mQ2@vL9#zT4$p',
      walletSeed: new Uint8Array(32).fill(8),
    }),
    createRuntime: async () => runtime,
  });

  test('restores a second round into a store that already holds another round key', async () => {
    const { runtime } = createRestoreRuntime({ otherRoundKey: true });
    const result = await runRestoreCommand(
      loadCliConfig({ environment: {} }),
      '/ignored/round-b-backup.json',
      restoreDependencies(runtime),
    );

    assert.equal(result.restoredSigningKeys, 1);
    assert.equal(result.skippedSigningKeys, 1);
  });

  test('rolls back the imported state when the backup lacks this contract key', async () => {
    const { calls, runtime } = createRestoreRuntime({ backupHasTargetKey: false });

    await assert.rejects(
      runRestoreCommand(
        loadCliConfig({ environment: {} }),
        '/ignored/backup.json',
        restoreDependencies(runtime),
      ),
      /did not restore the signing key for this contract/,
    );
    assert.equal(calls.includes('remove-private-state'), true);
    assert.equal(calls.includes('remove-signing-key'), false);
    assert.equal(calls.at(-1), 'close');
    assert.equal(await runtime.providers.privateStateProvider.get(), null);
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

  test('enrolls an applicant from their public ID and issues a receipt only they can open', async () => {
    const { calls, runtime } = createCommandRuntime(validCommandPrivateState());
    const contractAddress = sampleContractAddress();
    const roundId = new Uint8Array(32).fill(6);
    // The applicant's secret lives on their device; the institution sees only the ID.
    const applicantSecret = new Uint8Array(32).fill(0x44);
    const applicantIdHex = hexKey(deriveApplicantId(applicantSecret));
    const promptedValues = ['2', '350', '7'];
    const prompts = [];
    let salt;
    let capturedLeaf;
    const result = await runRegisterApplicantCommand(
      loadCliConfig({ environment: {} }),
      contractAddress,
      applicantIdHex,
      {
        runPrerequisiteChecks: async () => readyChecks,
        readSecrets: async () => ({
          privateStatePassword: 'R7!mQ2@vL9#zT4$p',
          walletSeed: new Uint8Array(32).fill(6),
        }),
        promptSecret: async (prompt) => {
          prompts.push(prompt);
          return promptedValues[prompts.length - 1];
        },
        createRuntime: async () => runtime,
        readLedger: async () => ledgerFixture({ roundId, phase: 0 }),
        generateSalt: () => {
          salt = new Uint8Array(32).fill(0x5a);
          return salt;
        },
        joinContract: async () => ({
          callTx: {
            registerApplicant: async (leaf) => {
              calls.push('register-applicant');
              capturedLeaf = Uint8Array.from(leaf);
              return { public: finalizedPublicData };
            },
          },
        }),
        writeBackup: async () => {
          calls.push('unexpected-backup');
          return '/ignored/register-applicant.json';
        },
      },
    );
    const opened = openEnrollmentReceipt(result.enrollmentReceipt, { roundId, applicantSecret });

    assert.deepEqual(
      Array.from(capturedLeaf),
      Array.from(deriveApplicantLeaf(2n, 350n, 7n, applicantSecret, new Uint8Array(32).fill(0x5a))),
    );
    assert.equal(result.enrollmentLeaf, hexKey(capturedLeaf));
    assert.equal(result.applicantId, applicantIdHex);
    assert.equal(result.transactionId, 'tx-id-1');
    assert.equal(opened.incomeBand, 2n);
    assert.equal(opened.gpaScaled, 350n);
    assert.equal(opened.regionCode, 7n);
    assert.equal(prompts.length, 3);
    assert.equal(
      salt.every((byte) => byte === 0),
      true,
    );
    assert.deepEqual(calls, ['start', 'funding', 'register-applicant', 'close']);
  });

  test('refuses to enroll an applicant once the round has left setup', async () => {
    const { calls, runtime } = createCommandRuntime(validCommandPrivateState());

    await assert.rejects(
      runRegisterApplicantCommand(
        loadCliConfig({ environment: {} }),
        sampleContractAddress(),
        'ab'.repeat(32),
        {
          runPrerequisiteChecks: async () => readyChecks,
          readSecrets: async () => ({
            privateStatePassword: 'R7!mQ2@vL9#zT4$p',
            walletSeed: new Uint8Array(32).fill(6),
          }),
          promptSecret: async () => '2',
          createRuntime: async () => runtime,
          readLedger: async () => ledgerFixture({ roundId: new Uint8Array(32).fill(6), phase: 1 }),
          joinContract: async () => ({
            callTx: {
              registerApplicant: async () => {
                calls.push('must-not-register');
                return { public: finalizedPublicData };
              },
            },
          }),
        },
      ),
      /only be enrolled while the round is in setup/,
    );
    assert.equal(calls.includes('must-not-register'), false);
    assert.equal(calls.at(-1), 'close');
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

describe('AEQUIRA CLI applicant commands', () => {
  const roundId = new Uint8Array(32).fill(6);
  const institutionSalt = new Uint8Array(32).fill(0x5a);
  // A fresh store: applicant secret drawn at join, no receipt imported yet.
  const unenrolledState = () =>
    privateStateFixture({
      applicantIncomeBand: 0n,
      applicantGpaScaled: 0n,
      applicantRegionCode: 0n,
      applicantSalt: new Uint8Array(32),
    });
  const issueFor = (applicantSecret) =>
    issueEnrollmentReceipt({
      roundId,
      applicantId: deriveApplicantId(applicantSecret),
      incomeBand: 2n,
      gpaScaled: 350n,
      regionCode: 7n,
      salt: institutionSalt,
    });
  const importDependencies = (runtime, receipt, ledger, overrides = {}) => ({
    readSecrets: async () => ({
      privateStatePassword: 'R7!mQ2@vL9#zT4$p',
      walletSeed: new Uint8Array(32).fill(6),
    }),
    promptSecret: async () => receipt,
    createRuntime: async () => runtime,
    readLedger: async () => ledger,
    writeBackup: async () => '/ignored/import-enrollment.json',
    ...overrides,
  });

  test('imports the institution receipt into private state without syncing a wallet', async () => {
    const privateState = unenrolledState();
    const { calls, getStoredPrivateState, runtime } = createCommandRuntime(privateState);
    const { enrollmentLeaf, receipt } = issueFor(privateState.applicantSecret);
    const result = await runImportEnrollmentCommand(
      loadCliConfig({ environment: {} }),
      sampleContractAddress(),
      importDependencies(
        runtime,
        receipt,
        ledgerFixture({ roundId, enrolledLeaves: [enrollmentLeaf] }),
        {
          writeBackup: async () => {
            calls.push('backup');
            return '/ignored/import-enrollment.json';
          },
        },
      ),
    );

    assert.equal(result.enrolledOnChain, true);
    assert.equal(result.enrollmentLeaf, hexKey(enrollmentLeaf));
    assert.equal(result.applicantId, hexKey(deriveApplicantId(privateState.applicantSecret)));
    assert.equal(getStoredPrivateState().applicantIncomeBand, 2n);
    assert.equal(getStoredPrivateState().applicantGpaScaled, 350n);
    assert.equal(getStoredPrivateState().applicantRegionCode, 7n);
    assert.deepEqual(
      Array.from(getStoredPrivateState().applicantSalt),
      Array.from(institutionSalt),
    );
    assert.deepEqual(calls, ['set-private-state', 'backup', 'close']);
  });

  test('reports a valid receipt whose registration is not on chain yet', async () => {
    const privateState = unenrolledState();
    const { runtime } = createCommandRuntime(privateState);
    const { receipt } = issueFor(privateState.applicantSecret);
    const result = await runImportEnrollmentCommand(
      loadCliConfig({ environment: {} }),
      sampleContractAddress(),
      importDependencies(runtime, receipt, ledgerFixture({ roundId })),
    );

    assert.equal(result.enrolledOnChain, false);
  });

  test('refuses a receipt issued for another applicant, leaving private state untouched', async () => {
    const privateState = unenrolledState();
    const { calls, runtime } = createCommandRuntime(privateState);
    const { receipt } = issueFor(new Uint8Array(32).fill(0x77));

    await assert.rejects(
      runImportEnrollmentCommand(
        loadCliConfig({ environment: {} }),
        sampleContractAddress(),
        importDependencies(runtime, receipt, ledgerFixture({ roundId })),
      ),
      (error) =>
        /different applicant/.test(error.message) &&
        !error.message.includes(hexKey(institutionSalt)),
    );
    assert.equal(calls.includes('set-private-state'), false);
    assert.equal(calls.at(-1), 'close');
  });

  test('refuses to change the enrollment after the applicant has applied or review opened', async () => {
    const privateState = unenrolledState();
    const { receipt } = issueFor(privateState.applicantSecret);
    const applied = createCommandRuntime(privateState);

    await assert.rejects(
      runImportEnrollmentCommand(
        loadCliConfig({ environment: {} }),
        sampleContractAddress(),
        importDependencies(
          applied.runtime,
          receipt,
          ledgerFixture({
            roundId,
            phase: 1,
            applyNullifiers: [deriveApplyNullifier(roundId, privateState.applicantSecret)],
          }),
        ),
      ),
      /already applied to the round/,
    );

    const reviewing = createCommandRuntime(privateState);

    await assert.rejects(
      runImportEnrollmentCommand(
        loadCliConfig({ environment: {} }),
        sampleContractAddress(),
        importDependencies(reviewing.runtime, receipt, ledgerFixture({ roundId, phase: 2 })),
      ),
      /before review opens/,
    );
    assert.equal(applied.calls.includes('set-private-state'), false);
    assert.equal(reviewing.calls.includes('set-private-state'), false);
  });

  test('does not import a receipt without local private state', async () => {
    const { calls, runtime } = createCommandRuntime();

    await assert.rejects(
      runImportEnrollmentCommand(
        loadCliConfig({ environment: {} }),
        sampleContractAddress(),
        importDependencies(runtime, 'aequira-enrollment:v1', ledgerFixture({ roundId })),
      ),
      /run join before submitting a contract call/,
    );
    assert.equal(calls.at(-1), 'close');
  });

  test('keeps the imported enrollment when backup creation fails', async () => {
    const privateState = unenrolledState();
    const { getStoredPrivateState, runtime } = createCommandRuntime(privateState);
    const { receipt } = issueFor(privateState.applicantSecret);

    await assert.rejects(
      runImportEnrollmentCommand(
        loadCliConfig({ environment: {} }),
        sampleContractAddress(),
        importDependencies(runtime, receipt, ledgerFixture({ roundId }), {
          writeBackup: async () => {
            throw new Error('/local/private-state/backup failed');
          },
        }),
      ),
      (error) =>
        error instanceof EnrollmentBackupError &&
        error.message.includes('Preserve the private-state directory') &&
        !error.message.includes('/local/private-state'),
    );
    assert.equal(getStoredPrivateState().applicantIncomeBand, 2n);
  });

  test('refuses to apply before an enrollment receipt is imported', async () => {
    const { calls, runtime } = createCommandRuntime(unenrolledState());

    await assert.rejects(
      runApplyCommand(loadCliConfig({ environment: {} }), sampleContractAddress(), {
        runPrerequisiteChecks: async () => readyChecks,
        readSecrets: async () => ({
          privateStatePassword: 'R7!mQ2@vL9#zT4$p',
          walletSeed: new Uint8Array(32).fill(7),
        }),
        createRuntime: async () => runtime,
        readLedger: async () => ledgerFixture({ roundId, phase: 1 }),
        joinContract: async () => ({
          callTx: {
            apply: async () => {
              calls.push('must-not-apply');
              return { public: finalizedPublicData };
            },
          },
        }),
      }),
      /run import-enrollment first/,
    );
    assert.equal(calls.includes('must-not-apply'), false);
  });

  test('refuses a second application and names the one already submitted', async () => {
    const privateState = privateStateFixture();
    const { calls, runtime } = createCommandRuntime(privateState);
    const nonce = await deriveApplicationNonce(roundId, privateState.applicantSecret);
    const applicationId = hexKey(
      deriveApplicationPseudonym(roundId, privateState.applicantSecret, nonce),
    );

    await assert.rejects(
      runApplyCommand(loadCliConfig({ environment: {} }), sampleContractAddress(), {
        runPrerequisiteChecks: async () => readyChecks,
        readSecrets: async () => ({
          privateStatePassword: 'R7!mQ2@vL9#zT4$p',
          walletSeed: new Uint8Array(32).fill(7),
        }),
        createRuntime: async () => runtime,
        readLedger: async () =>
          ledgerFixture({
            roundId,
            phase: 1,
            applyNullifiers: [deriveApplyNullifier(roundId, privateState.applicantSecret)],
          }),
        joinContract: async () => ({
          callTx: {
            apply: async () => {
              calls.push('must-not-apply');
              return { public: finalizedPublicData };
            },
          },
        }),
      }),
      new RegExp(`already applied to the round as application ${applicationId}`),
    );
    assert.equal(calls.includes('must-not-apply'), false);
  });

  test('submits an application deriving the nonce from the round and the applicant secret', async () => {
    const privateState = privateStateFixture();
    const { calls, runtime } = createCommandRuntime(privateState);
    const contractAddress = sampleContractAddress();
    let capturedNonce;

    const result = await runApplyCommand(loadCliConfig({ environment: {} }), contractAddress, {
      runPrerequisiteChecks: async () => readyChecks,
      readSecrets: async () => ({
        privateStatePassword: 'R7!mQ2@vL9#zT4$p',
        walletSeed: new Uint8Array(32).fill(7),
      }),
      createRuntime: async () => runtime,
      readLedger: async () => ledgerFixture({ roundId, phase: 1 }),
      joinContract: async () => ({
        callTx: {
          apply: async (submittedNonce) => {
            calls.push('apply');
            capturedNonce = Uint8Array.from(submittedNonce);
            return { public: finalizedPublicData };
          },
        },
      }),
      writeBackup: async () => {
        calls.push('backup');
        return '/ignored/apply.json';
      },
    });

    const expectedNonce = await deriveApplicationNonce(roundId, privateState.applicantSecret);

    assert.equal(result.transactionId, 'tx-id-1');
    assert.deepEqual(Array.from(capturedNonce), Array.from(expectedNonce));
    assert.equal(
      result.applicationId,
      hexKey(deriveApplicationPseudonym(roundId, privateState.applicantSecret, expectedNonce)),
    );
    assert.deepEqual(calls, ['start', 'funding', 'apply', 'backup', 'close']);
  });

  test('does not submit an application without local private state', async () => {
    const { calls, runtime } = createCommandRuntime();
    const contractAddress = sampleContractAddress();

    await assert.rejects(
      runApplyCommand(loadCliConfig({ environment: {} }), contractAddress, {
        runPrerequisiteChecks: async () => readyChecks,
        readSecrets: async () => ({
          privateStatePassword: 'R7!mQ2@vL9#zT4$p',
          walletSeed: new Uint8Array(32).fill(9),
        }),
        createRuntime: async () => runtime,
        readLedger: async () => ledgerFixture({ roundId, phase: 1 }),
        joinContract: async () => {
          // A join stores a signing key, which would make `restore` refuse
          // this round later, so it must not happen without private state.
          calls.push('join');
          return {
            callTx: {
              apply: async () => {
                calls.push('must-not-submit');
                return { public: finalizedPublicData };
              },
            },
          };
        },
      }),
      /run join before submitting a contract call/,
    );
    // Refused before the wallet syncs or the round is joined.
    assert.deepEqual(calls, ['close']);
  });
});

describe('AEQUIRA CLI score commands', () => {
  const roundId = new Uint8Array(32).fill(6);
  // The commitment a reviewer's own opening produces, as the ledger records it.
  const commitmentFor = async (
    applicationId,
    score,
    reviewerSecret = privateStateFixture().reviewerSecret,
  ) =>
    deriveScoreCommitment(
      roundId,
      applicationId,
      score,
      reviewerSecret,
      await deriveScoreSalt(roundId, applicationId, reviewerSecret),
    );

  test('commits a masked score, deriving its salt from the round and application', async () => {
    const privateState = privateStateFixture();
    const { calls, getStoredPrivateState, runtime } = createCommandRuntime(privateState);
    const walletSeed = new Uint8Array(32).fill(7);
    const contractAddress = sampleContractAddress();
    const applicationId = new Uint8Array(32).fill(0xab);
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
        readLedger: async () => ledgerFixture({ roundId, phase: 2, applications: [applicationId] }),
        joinContract: async () => ({
          callTx: {
            commitScore: async (submittedApplicationId) => {
              calls.push('commit-score');
              capturedApplicationId = Uint8Array.from(submittedApplicationId);
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
    assert.deepEqual(
      Array.from(getStoredPrivateState().scoreSalt),
      Array.from(await deriveScoreSalt(roundId, applicationId, privateState.reviewerSecret)),
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

  test('reveals a score by re-deriving its opening, not by trusting whatever private state currently holds', async () => {
    // Simulates the exact regression this fixes: the single scoreSalt slot
    // still holds a *different* application's opening (as it would right
    // after committing that other application), yet revealing this
    // application must still recompute the correct (score, salt) for it.
    const privateState = privateStateFixture({
      score: 42n,
      scoreSalt: new Uint8Array(32).fill(9),
    });
    const { calls, getStoredPrivateState, runtime } = createCommandRuntime(privateState);
    const walletSeed = new Uint8Array(32).fill(8);
    const contractAddress = sampleContractAddress();
    const applicationId = new Uint8Array(32).fill(0xcd);
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
        promptSecret: async () => '87',
        createRuntime: async () => runtime,
        readLedger: async () =>
          ledgerFixture({
            roundId,
            phase: 3,
            scoreCommitments: [await commitmentFor(applicationId, 87n)],
          }),
        joinContract: async () => ({
          callTx: {
            revealScore: async (submittedApplicationId) => {
              calls.push('reveal-score');
              assert.deepEqual(Array.from(submittedApplicationId), Array(32).fill(0xcd));
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
    assert.equal(getStoredPrivateState().score, 87n);
    assert.deepEqual(
      Array.from(getStoredPrivateState().scoreSalt),
      Array.from(await deriveScoreSalt(roundId, applicationId, privateState.reviewerSecret)),
    );
    assert.deepEqual(calls, [
      'start',
      'funding',
      'set-private-state',
      'reveal-score',
      'backup',
      'close',
    ]);
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
        promptSecret: async () => '87',
        createRuntime: async () => runtime,
        readLedger: async () => ledgerFixture({ roundId, phase: 3 }),
        joinContract: async () => {
          // A join stores a signing key, which would make `restore` refuse
          // this round later, so it must not happen without private state.
          calls.push('join');
          return {
            callTx: {
              revealScore: async () => {
                calls.push('must-not-submit');
                return { public: finalizedPublicData };
              },
            },
          };
        },
      }),
      /run join before submitting a contract call/,
    );
    // Refused before the wallet syncs or the round is joined.
    assert.deepEqual(calls, ['close']);
  });

  test('preserves finalized call identity when backup creation fails', async () => {
    const privateState = privateStateFixture({ score: 87n });
    const { runtime } = createCommandRuntime(privateState);
    const contractAddress = sampleContractAddress();

    await assert.rejects(
      runRevealScoreCommand(loadCliConfig({ environment: {} }), contractAddress, 'cd'.repeat(32), {
        runPrerequisiteChecks: async () => readyChecks,
        readSecrets: async () => ({
          privateStatePassword: 'R7!mQ2@vL9#zT4$p',
          walletSeed: new Uint8Array(32).fill(9),
        }),
        promptSecret: async () => '87',
        createRuntime: async () => runtime,
        readLedger: async () =>
          ledgerFixture({
            roundId,
            phase: 3,
            scoreCommitments: [await commitmentFor(new Uint8Array(32).fill(0xcd), 87n)],
          }),
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

  test('commits two different applications for the same reviewer without stranding either one', async () => {
    // The concrete failure scenario the fix addresses: a random-per-commit
    // salt would leave application A's opening unrecoverable once
    // application B is committed, because the single scoreSalt/score slot
    // gets overwritten. With deterministic, per-application derivation, both
    // stay independently revealable.
    const reviewerSecret = new Uint8Array(32).fill(2);
    const privateState = privateStateFixture({ reviewerSecret });
    const { getStoredPrivateState, runtime } = createCommandRuntime(privateState);
    const contractAddress = sampleContractAddress();
    const applicationA = new Uint8Array(32).fill(0xaa);
    const applicationB = new Uint8Array(32).fill(0xbb);

    const commitDependencies = (score) => ({
      runPrerequisiteChecks: async () => readyChecks,
      readSecrets: async () => ({
        privateStatePassword: 'R7!mQ2@vL9#zT4$p',
        walletSeed: new Uint8Array(32).fill(7),
      }),
      promptSecret: async () => score,
      createRuntime: async () => runtime,
      readLedger: async () =>
        ledgerFixture({ roundId, phase: 2, applications: [applicationA, applicationB] }),
      joinContract: async () => ({
        callTx: {
          commitScore: async () => ({ public: finalizedPublicData }),
        },
      }),
      writeBackup: async () => '/ignored/commit-score.json',
    });

    await runCommitScoreCommand(
      loadCliConfig({ environment: {} }),
      contractAddress,
      Buffer.from(applicationA).toString('hex'),
      commitDependencies('60'),
    );
    const saltAfterA = getStoredPrivateState().scoreSalt;

    await runCommitScoreCommand(
      loadCliConfig({ environment: {} }),
      contractAddress,
      Buffer.from(applicationB).toString('hex'),
      commitDependencies('75'),
    );
    const saltAfterB = getStoredPrivateState().scoreSalt;

    assert.notDeepEqual(Array.from(saltAfterA), Array.from(saltAfterB));

    // Revealing A afterwards must recompute A's own opening, not reuse
    // whatever B's commit left behind in the single private-state slot.
    const revealResult = await runRevealScoreCommand(
      loadCliConfig({ environment: {} }),
      contractAddress,
      Buffer.from(applicationA).toString('hex'),
      {
        runPrerequisiteChecks: async () => readyChecks,
        readSecrets: async () => ({
          privateStatePassword: 'R7!mQ2@vL9#zT4$p',
          walletSeed: new Uint8Array(32).fill(8),
        }),
        promptSecret: async () => '60',
        createRuntime: async () => runtime,
        readLedger: async () =>
          ledgerFixture({
            roundId,
            phase: 3,
            scoreCommitments: [await commitmentFor(applicationA, 60n, reviewerSecret)],
          }),
        joinContract: async () => ({
          callTx: {
            revealScore: async () => ({ public: finalizedPublicData }),
          },
        }),
        writeBackup: async () => '/ignored/reveal-score.json',
      },
    );

    assert.equal(revealResult.transactionId, 'tx-id-1');
    assert.deepEqual(Array.from(getStoredPrivateState().scoreSalt), Array.from(saltAfterA));
  });

  const scoreDependencies = (runtime, calls, ledger, prompts = ['87', '87']) => {
    let promptIndex = 0;
    return {
      runPrerequisiteChecks: async () => readyChecks,
      readSecrets: async () => ({
        privateStatePassword: 'R7!mQ2@vL9#zT4$p',
        walletSeed: new Uint8Array(32).fill(7),
      }),
      promptSecret: async () => prompts[promptIndex++],
      createRuntime: async () => {
        calls.push('runtime');
        return runtime;
      },
      readLedger: async () => ledger,
      joinContract: async () => ({
        callTx: {
          commitScore: async () => {
            calls.push('must-not-submit');
            return { public: finalizedPublicData };
          },
          revealScore: async () => {
            calls.push('must-not-submit');
            return { public: finalizedPublicData };
          },
        },
      }),
    };
  };

  test('refuses to commit a score for an ID that is not a submitted application', async () => {
    // The nullifier would make a mistyped ID permanent, and after the contract
    // fix such a commitment could never be revealed.
    const { calls, runtime } = createCommandRuntime(privateStateFixture());

    await assert.rejects(
      runCommitScoreCommand(
        loadCliConfig({ environment: {} }),
        sampleContractAddress(),
        'ab'.repeat(32),
        scoreDependencies(runtime, calls, ledgerFixture({ roundId, phase: 2 })),
      ),
      /not a submitted application in this round/,
    );
    assert.equal(calls.includes('set-private-state'), false);
    assert.equal(calls.includes('must-not-submit'), false);
  });

  test('refuses to commit twice for the same application', async () => {
    const privateState = privateStateFixture();
    const applicationId = new Uint8Array(32).fill(0xab);
    const { calls, runtime } = createCommandRuntime(privateState);

    await assert.rejects(
      runCommitScoreCommand(
        loadCliConfig({ environment: {} }),
        sampleContractAddress(),
        'ab'.repeat(32),
        scoreDependencies(
          runtime,
          calls,
          ledgerFixture({
            roundId,
            phase: 2,
            applications: [applicationId],
            scoreNullifiers: [
              deriveScoreNullifier(roundId, applicationId, privateState.reviewerSecret),
            ],
          }),
        ),
      ),
      /already committed a score for that application/,
    );
    assert.equal(calls.includes('must-not-submit'), false);
  });

  test('refuses a commit whose score confirmation does not match, before opening a wallet', async () => {
    const { calls, runtime } = createCommandRuntime(privateStateFixture());

    await assert.rejects(
      runCommitScoreCommand(
        loadCliConfig({ environment: {} }),
        sampleContractAddress(),
        'ab'.repeat(32),
        scoreDependencies(runtime, calls, ledgerFixture({ roundId, phase: 2 }), ['85', '58']),
      ),
      (error) => /do not match/.test(error.message) && !/85|58/.test(error.message),
    );
    assert.equal(calls.includes('runtime'), false);
  });

  test('refuses to reveal a score that does not open the recorded commitment', async () => {
    const { calls, runtime } = createCommandRuntime(privateStateFixture());
    const applicationId = new Uint8Array(32).fill(0xcd);

    await assert.rejects(
      runRevealScoreCommand(
        loadCliConfig({ environment: {} }),
        sampleContractAddress(),
        'cd'.repeat(32),
        scoreDependencies(
          runtime,
          calls,
          ledgerFixture({
            roundId,
            phase: 3,
            scoreCommitments: [await commitmentFor(applicationId, 85n)],
          }),
          ['58'],
        ),
      ),
      /does not open a commitment recorded for this application/,
    );
    assert.equal(calls.includes('set-private-state'), false);
    assert.equal(calls.includes('must-not-submit'), false);
  });
});

describe('AEQUIRA CLI round status', () => {
  const roundId = new Uint8Array(32).fill(6);
  const revealed = new Uint8Array(32).fill(0xaa);
  const sealed = new Uint8Array(32).fill(0xbb);
  const reviewer = new Uint8Array(32).fill(0xcc);
  const ledger = ledgerFixture({
    roundId,
    phase: 3,
    applications: [revealed, sealed],
    applyNullifiers: [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)],
    enrolledLeaves: [new Uint8Array(32).fill(3), new Uint8Array(32).fill(4)],
    reviewers: [reviewer],
    revealedCounts: [[revealed, 1n]],
    scoreCommitments: [new Uint8Array(32).fill(5)],
    scoreNullifiers: [new Uint8Array(32).fill(7), new Uint8Array(32).fill(8)],
    scoreSums: [[revealed, 87n]],
  });

  test('summarizes the public ledger, listing every submitted application', () => {
    assert.deepEqual(toRoundStatus(ledger), {
      applications: [
        { applicationId: hexKey(revealed), revealedCount: '1', scoreSum: '87' },
        { applicationId: hexKey(sealed), revealedCount: null, scoreSum: null },
      ],
      applyNullifiers: '2',
      enrollmentLeaves: '2',
      maxIncomeBand: '3',
      minGpaScaled: '300',
      phase: 'REVEAL',
      reviewers: [hexKey(reviewer)],
      scoreCommitments: '1',
      scoreNullifiers: '2',
    });
  });

  test('reads the ledger without asking for any secret', async () => {
    let readSecrets = false;
    const status = await runRoundStatusCommand(
      loadCliConfig({ environment: {} }),
      sampleContractAddress(),
      {
        createPublicDataProvider: () => ({ publicDataProvider: {} }),
        readLedger: async () => ledger,
        readSecrets: async () => {
          readSecrets = true;
          throw new Error('must not run');
        },
      },
    );

    assert.equal(status.phase, 'REVEAL');
    assert.equal(readSecrets, false);
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
      undefined,
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
      dustReceiverAddress: null,
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
    const noOpRegistration = await runRegisterDustCommand(
      loadCliConfig({ environment: {} }),
      undefined,
      {
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
      },
    );
    assert.equal(noOpRegistration.submitted, false);
    assert.equal(noOpRegistration.transactionId, null);
    assert.equal(
      noOpSeed.every((byte) => byte === 0),
      true,
    );

    const cleanupFailureSeed = new Uint8Array(32).fill(14);
    await assert.rejects(
      runRegisterDustCommand(loadCliConfig({ environment: {} }), undefined, {
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

  test('register-dust directs generated Dust to another wallet', async () => {
    // A wallet holding zero Dust cannot pay for its own registration, so NIGHT owned by the CLI
    // wallet generates Dust straight into the other wallet's Dust address.
    const receiver = 'mn_dust_preprod1wwccv5pa0c4flstyp0vwtyn68s046p4cujfhegh36evqu77yjylj5ke532j';
    const seed = new Uint8Array(32).fill(21);
    let receivedAddress;

    const result = await runRegisterDustCommand(
      loadCliConfig({ environment: {}, network: 'preprod' }),
      receiver,
      {
        readWalletSeed: async () => seed,
        createWalletProvider: async () => ({
          accountId: 'mn_addr_preprod1public',
          start: async () => undefined,
          registerAvailableNightForDust: async (dustReceiverAddress) => {
            receivedAddress = dustReceiverAddress;
            return { dustBalanceBefore: 0n, registeredUtxos: 1, transactionId: 'dust-tx-2' };
          },
          stop: async () => undefined,
        }),
      },
    );

    assert.equal(result.dustReceiverAddress, receiver);
    assert.equal(result.submitted, true);
    // The provider is handed a decoded address, never the raw string.
    assert.equal(typeof receivedAddress?.data, 'bigint');
    assert.equal(MidnightBech32m.encode('preprod', receivedAddress).asString(), receiver);
    assert.equal(
      seed.every((byte) => byte === 0),
      true,
    );
  });

  test('register-dust rejects a Dust address from another network or kind', async () => {
    const rejects = async (value, expected) => {
      let walletCreated = false;

      await assert.rejects(
        runRegisterDustCommand(loadCliConfig({ environment: {}, network: 'preprod' }), value, {
          readWalletSeed: async () => new Uint8Array(32).fill(22),
          createWalletProvider: async () => {
            walletCreated = true;
            throw new Error('wallet must not be created for an invalid Dust address');
          },
        }),
        (error) => expected.test(error.message),
      );

      // The address is validated before any wallet, secret or network access happens.
      assert.equal(walletCreated, false);
    };

    await rejects(
      'mn_dust_preview1wwccv5pa0c4flstyp0vwtyn68s046p4cujfhegh36evqu77yjylj5h8yzhj',
      /preprod/,
    );
    await rejects(
      'mn_addr_preprod1mmg7knvhzvmedvndxxtlh26hxmyp8weewj6rc5zhfej07sk05m4qe9jxjd',
      /Expected a Dust address/,
    );
    await rejects('not-an-address', /not valid bech32m/);
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
