import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const NETWORKS = ['preview', 'preprod'] as const;

export type AequiraNetwork = (typeof NETWORKS)[number];

export type NetworkEndpoints = {
  readonly network: AequiraNetwork;
  readonly walletNetworkId: AequiraNetwork;
  readonly indexer: string;
  readonly indexerWs: string;
  readonly node: string;
  readonly nodeWs: string;
  readonly faucet: string;
};

export type CliConfig = NetworkEndpoints & {
  readonly privateStateDirectory: string;
  readonly proofServer: string;
  readonly zkConfigPath: string;
};

const NETWORK_ENDPOINTS: Readonly<Record<AequiraNetwork, NetworkEndpoints>> = {
  preview: {
    network: 'preview',
    walletNetworkId: 'preview',
    indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
    indexerWs: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
    node: 'https://rpc.preview.midnight.network',
    nodeWs: 'wss://rpc.preview.midnight.network',
    faucet: 'https://midnight-tmnight-preview.nethermind.dev/',
  },
  preprod: {
    network: 'preprod',
    walletNetworkId: 'preprod',
    indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
    indexerWs: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
    node: 'https://rpc.preprod.midnight.network',
    nodeWs: 'wss://rpc.preprod.midnight.network',
    faucet: 'https://midnight-tmnight-preprod.nethermind.dev/',
  },
};

const DEFAULT_PROOF_SERVER = 'http://127.0.0.1:6300';
const DEFAULT_PRIVATE_STATE_DIRECTORY = fileURLToPath(
  new URL('../../../.private-state/aequira/', import.meta.url),
);
const DEFAULT_ZK_CONFIG_PATH = fileURLToPath(
  new URL('../../contract/dist/managed/aequira/', import.meta.url),
);

export type CliEnvironment = Readonly<
  Partial<
    Record<'AEQUIRA_NETWORK' | 'AEQUIRA_PRIVATE_STATE_DIR' | 'AEQUIRA_PROOF_SERVER_URL', string>
  >
>;

const isAequiraNetwork = (value: string): value is AequiraNetwork =>
  NETWORKS.some((network) => network === value);

const parseNetwork = (value: string | undefined): AequiraNetwork => {
  const network = value ?? 'preprod';

  if (!isAequiraNetwork(network)) {
    throw new Error(`Unsupported network "${network}". Expected one of: ${NETWORKS.join(', ')}`);
  }

  return network;
};

const parseHttpUrl = (name: string, value: string): string => {
  const url = new URL(value);

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${name} must use http or https`);
  }

  if (url.username !== '' || url.password !== '') {
    throw new Error(`${name} must not contain credentials`);
  }

  return url.toString().replace(/\/$/, '');
};

const parsePrivateStateDirectory = (value: string): string => {
  const directory = path.resolve(value);

  if (directory === path.parse(directory).root) {
    throw new Error('private state directory must not be a filesystem root');
  }

  return directory;
};

export type LoadCliConfigOptions = {
  readonly environment?: CliEnvironment;
  readonly network?: string;
  readonly proofServer?: string;
};

export const loadCliConfig = (options: LoadCliConfigOptions = {}): CliConfig => {
  const environment = options.environment ?? process.env;
  const network = parseNetwork(options.network ?? environment.AEQUIRA_NETWORK);
  const endpoints = NETWORK_ENDPOINTS[network];

  return {
    ...endpoints,
    privateStateDirectory: parsePrivateStateDirectory(
      environment.AEQUIRA_PRIVATE_STATE_DIR ?? DEFAULT_PRIVATE_STATE_DIRECTORY,
    ),
    proofServer: parseHttpUrl(
      'proof server URL',
      options.proofServer ?? environment.AEQUIRA_PROOF_SERVER_URL ?? DEFAULT_PROOF_SERVER,
    ),
    zkConfigPath: DEFAULT_ZK_CONFIG_PATH,
  };
};
