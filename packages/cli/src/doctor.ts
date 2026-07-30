import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

import type { CliConfig } from './config.js';

const CIRCUITS = [
  'commitScore',
  'openApplications',
  'openReveal',
  'openReview',
  'registerReviewer',
  'revealScore',
] as const;

const MINIMUM_NODE_VERSION = [24, 11, 1] as const;

export type DoctorCheck = {
  readonly detail: string;
  readonly name: string;
  readonly ok: boolean;
};

export type DoctorDependencies = {
  readonly accessFile?: (path: string) => Promise<void>;
  readonly fetchUrl?: typeof fetch;
  readonly nodeVersion?: string;
};

const requiredZkAssets = (zkConfigPath: string): readonly string[] =>
  CIRCUITS.flatMap((circuit) => [
    path.join(zkConfigPath, 'keys', `${circuit}.prover`),
    path.join(zkConfigPath, 'keys', `${circuit}.verifier`),
    path.join(zkConfigPath, 'zkir', `${circuit}.zkir`),
  ]);

const checkNodeVersion = (nodeVersion: string): DoctorCheck => {
  const parsed = nodeVersion
    .split('.')
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10));
  const [major = Number.NaN, minor = Number.NaN, patch = Number.NaN] = parsed;
  const [minimumMajor, minimumMinor, minimumPatch] = MINIMUM_NODE_VERSION;
  const ok =
    parsed.length === MINIMUM_NODE_VERSION.length &&
    parsed.every(Number.isInteger) &&
    (major > minimumMajor ||
      (major === minimumMajor &&
        (minor > minimumMinor || (minor === minimumMinor && patch >= minimumPatch))));

  return {
    name: 'node',
    ok,
    detail: ok
      ? `Node ${nodeVersion}`
      : `Node ${nodeVersion} is unsupported; 24.11.1 or newer is required`,
  };
};

const checkZkAssets = async (
  config: CliConfig,
  accessFile: (path: string) => Promise<void>,
): Promise<DoctorCheck> => {
  const assets = requiredZkAssets(config.zkConfigPath);

  try {
    await Promise.all(assets.map((asset) => accessFile(asset)));
    return {
      name: 'zk-assets',
      ok: true,
      detail: `${assets.length} required ZK assets are readable`,
    };
  } catch {
    return {
      name: 'zk-assets',
      ok: false,
      detail: `ZK assets are missing; run "pnpm compact:build" and "pnpm build"`,
    };
  }
};

const checkHttpService = async (
  name: string,
  label: string,
  url: string,
  fetchUrl: typeof fetch,
): Promise<DoctorCheck> => {
  try {
    const response = await fetchUrl(url, {
      method: 'GET',
      signal: AbortSignal.timeout(3_000),
    });

    return {
      name,
      ok: true,
      detail: `${label} responded with HTTP ${response.status}`,
    };
  } catch {
    return {
      name,
      ok: false,
      detail: `${label} is unreachable at ${url}`,
    };
  }
};

export const runDoctor = async (
  config: CliConfig,
  dependencies: DoctorDependencies = {},
): Promise<readonly DoctorCheck[]> => {
  const accessFile =
    dependencies.accessFile ?? ((filePath: string) => access(filePath, constants.R_OK));
  const fetchUrl = dependencies.fetchUrl ?? fetch;
  const nodeVersion = dependencies.nodeVersion ?? process.versions.node;

  return Promise.all([
    Promise.resolve(checkNodeVersion(nodeVersion)),
    checkZkAssets(config, accessFile),
    checkHttpService('network-node', 'Network node', config.node, fetchUrl),
    checkHttpService('indexer', 'Indexer', config.indexer, fetchUrl),
    checkHttpService('proof-server', 'Proof server', config.proofServer, fetchUrl),
  ]);
};
