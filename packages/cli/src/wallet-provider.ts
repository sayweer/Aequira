import type {
  MidnightProvider,
  UnboundTransaction,
  WalletProvider,
} from '@midnight-ntwrk/midnight-js-types';
import {
  DustSecretKey,
  LedgerParameters,
  ZswapSecretKeys,
  type CoinPublicKey,
  type EncPublicKey,
  type FinalizedTransaction,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import {
  createKeystore,
  DustWallet,
  HDWallet,
  InMemoryTransactionHistoryStorage,
  mergeWalletEntries,
  PublicKey,
  Roles,
  ShieldedWallet,
  UnshieldedWallet,
  WalletEntrySchema,
  WalletFacade,
  type DefaultConfiguration,
  type UnshieldedKeystore,
} from '@midnight-ntwrk/wallet-sdk';

import type { CliConfig } from './config.js';

const WALLET_SEED_BYTES = 32;
const MAX_DERIVATION_ATTEMPTS = 100;

const deriveRoleKey = (
  account: ReturnType<HDWallet['selectAccount']>,
  role: (typeof Roles)[keyof typeof Roles],
): Uint8Array => {
  for (let index = 0; index < MAX_DERIVATION_ATTEMPTS; index += 1) {
    const result = account.selectRole(role).deriveKeyAt(index);

    if (result.type === 'keyDerived') {
      return result.key;
    }
  }

  throw new Error('Wallet key derivation failed after 100 attempts');
};

type DerivedWalletKeys = {
  readonly dustSecretKey: DustSecretKey;
  readonly shieldedSecretKeys: ZswapSecretKeys;
  readonly unshieldedKeystore: UnshieldedKeystore;
};

export type WalletProviderDependencies = {
  readonly createWallet?: () => Promise<WalletFacade>;
};

const deriveWalletKeys = (
  seed: Uint8Array,
  networkId: CliConfig['walletNetworkId'],
): DerivedWalletKeys => {
  if (seed.byteLength !== WALLET_SEED_BYTES) {
    throw new RangeError(`wallet seed must contain exactly ${WALLET_SEED_BYTES} bytes`);
  }

  const result = HDWallet.fromSeed(seed);

  if (result.type !== 'seedOk') {
    throw new Error('Wallet seed could not be derived');
  }

  const hdWallet = result.hdWallet;
  const account = hdWallet.selectAccount(0);
  let shieldedSeed: Uint8Array | undefined;
  let dustSeed: Uint8Array | undefined;
  let unshieldedKey: Uint8Array | undefined;
  let keepUnshieldedKey = false;

  try {
    shieldedSeed = deriveRoleKey(account, Roles.Zswap);
    dustSeed = deriveRoleKey(account, Roles.Dust);
    unshieldedKey = deriveRoleKey(account, Roles.NightExternal);
    const unshieldedKeystore = createKeystore(unshieldedKey, networkId);
    keepUnshieldedKey = true;

    return {
      dustSecretKey: DustSecretKey.fromSeed(dustSeed),
      shieldedSecretKeys: ZswapSecretKeys.fromSeed(shieldedSeed),
      unshieldedKeystore,
    };
  } finally {
    hdWallet.clear();
    shieldedSeed?.fill(0);
    dustSeed?.fill(0);

    if (!keepUnshieldedKey) {
      unshieldedKey?.fill(0);
    }
  }
};

export const deriveUnshieldedAddress = (config: CliConfig, walletSeed: Uint8Array): string => {
  let hdWallet: HDWallet | undefined;
  let unshieldedKey: Uint8Array | undefined;

  try {
    if (walletSeed.byteLength !== WALLET_SEED_BYTES) {
      throw new RangeError(`wallet seed must contain exactly ${WALLET_SEED_BYTES} bytes`);
    }

    const result = HDWallet.fromSeed(walletSeed);

    if (result.type !== 'seedOk') {
      throw new Error('Wallet seed could not be derived');
    }

    hdWallet = result.hdWallet;
    unshieldedKey = deriveRoleKey(hdWallet.selectAccount(0), Roles.NightExternal);

    return PublicKey.fromKeyStore(createKeystore(unshieldedKey, config.walletNetworkId)).address;
  } finally {
    walletSeed.fill(0);
    unshieldedKey?.fill(0);
    hdWallet?.clear();
  }
};

export class AequiraWalletProvider implements MidnightProvider, WalletProvider {
  readonly accountId: string;
  readonly wallet: WalletFacade;

  #dustSecretKey: DustSecretKey | undefined;
  #shieldedSecretKeys: ZswapSecretKeys | undefined;
  #unshieldedKeystore: UnshieldedKeystore | undefined;
  #started = false;
  #stopped = false;

  private constructor(wallet: WalletFacade, keys: DerivedWalletKeys, accountId: string) {
    this.wallet = wallet;
    this.accountId = accountId;
    this.#dustSecretKey = keys.dustSecretKey;
    this.#shieldedSecretKeys = keys.shieldedSecretKeys;
    this.#unshieldedKeystore = keys.unshieldedKeystore;
  }

  static async create(
    config: CliConfig,
    walletSeed: Uint8Array,
    dependencies: WalletProviderDependencies = {},
  ): Promise<AequiraWalletProvider> {
    let keys: DerivedWalletKeys;

    try {
      keys = deriveWalletKeys(walletSeed, config.walletNetworkId);
    } finally {
      walletSeed.fill(0);
    }

    const publicKey = PublicKey.fromKeyStore(keys.unshieldedKeystore);
    const walletConfiguration: DefaultConfiguration = {
      networkId: config.walletNetworkId,
      costParameters: {
        feeBlocksMargin: 5,
      },
      relayURL: new URL(config.nodeWs),
      provingServerUrl: new URL(config.proofServer),
      indexerClientConnection: {
        indexerHttpUrl: config.indexer,
        indexerWsUrl: config.indexerWs,
      },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(
        WalletEntrySchema,
        mergeWalletEntries,
      ),
    };

    const wallet =
      dependencies.createWallet === undefined
        ? await WalletFacade.init({
            configuration: walletConfiguration,
            shielded: (walletConfig) =>
              ShieldedWallet(walletConfig).startWithSecretKeys(keys.shieldedSecretKeys),
            unshielded: (walletConfig) =>
              UnshieldedWallet(walletConfig).startWithPublicKey(publicKey),
            dust: (walletConfig) =>
              DustWallet(walletConfig).startWithSecretKey(
                keys.dustSecretKey,
                LedgerParameters.initialParameters().dust,
              ),
          })
        : await dependencies.createWallet();

    return new AequiraWalletProvider(wallet, keys, publicKey.address);
  }

  getCoinPublicKey(): CoinPublicKey {
    return this.getShieldedSecretKeys().coinPublicKey;
  }

  getEncryptionPublicKey(): EncPublicKey {
    return this.getShieldedSecretKeys().encryptionPublicKey;
  }

  async balanceTx(tx: UnboundTransaction, ttl: Date = ttlOneHour()): Promise<FinalizedTransaction> {
    const recipe = await this.wallet.balanceUnboundTransaction(
      tx,
      {
        shieldedSecretKeys: this.getShieldedSecretKeys(),
        dustSecretKey: this.getDustSecretKey(),
      },
      { ttl },
    );
    const signedRecipe = await this.wallet.signRecipe(recipe, (payload) =>
      this.getUnshieldedKeystore().signData(payload),
    );

    return this.wallet.finalizeRecipe(signedRecipe);
  }

  submitTx(tx: FinalizedTransaction): Promise<string> {
    return this.wallet.submitTransaction(tx);
  }

  async start(): Promise<void> {
    if (this.#stopped) {
      throw new Error('Wallet provider has already been stopped');
    }

    if (this.#started) {
      return;
    }

    await this.wallet.start(this.getShieldedSecretKeys(), this.getDustSecretKey());
    this.#started = true;
  }

  async waitForSync(): Promise<void> {
    if (!this.#started) {
      throw new Error('Wallet must be started before synchronization');
    }

    await this.wallet.waitForSyncedState();
  }

  async stop(): Promise<void> {
    if (this.#stopped) {
      return;
    }

    this.#stopped = true;

    try {
      await this.wallet.stop();
    } finally {
      this.#started = false;
      this.#dustSecretKey = undefined;
      this.#shieldedSecretKeys = undefined;
      this.#unshieldedKeystore = undefined;
    }
  }

  private getDustSecretKey(): DustSecretKey {
    if (this.#dustSecretKey === undefined) {
      throw new Error('Wallet secret keys are no longer available');
    }

    return this.#dustSecretKey;
  }

  private getShieldedSecretKeys(): ZswapSecretKeys {
    if (this.#shieldedSecretKeys === undefined) {
      throw new Error('Wallet secret keys are no longer available');
    }

    return this.#shieldedSecretKeys;
  }

  private getUnshieldedKeystore(): UnshieldedKeystore {
    if (this.#unshieldedKeystore === undefined) {
      throw new Error('Wallet secret keys are no longer available');
    }

    return this.#unshieldedKeystore;
  }
}
