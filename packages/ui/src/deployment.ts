import {
  createAequiraPrivateState,
  deployAequira,
  type AequiraPrivateState,
  type FoundAequiraContract,
} from '@aequira/sdk';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';

import { createBrowserProviderSession, type BrowserProviderSession } from './browser-providers.js';
import { withDeploymentStage } from './deployment-errors.js';
import type { EligibilityThresholds } from './round-inputs.js';

const PRIVATE_VALUE_LENGTH = 32;

const randomPrivateValue = (): Uint8Array =>
  crypto.getRandomValues(new Uint8Array(PRIVATE_VALUE_LENGTH));

/**
 * Fresh secrets for a browser that holds nothing for a round yet. The applicant
 * attributes and salt stay zero until the institution's enrollment receipt is
 * imported; an all-zero salt is how the SDK tells no receipt has arrived.
 */
export const createRandomPrivateState = (): AequiraPrivateState =>
  createAequiraPrivateState({
    adminSecret: randomPrivateValue(),
    reviewerSecret: randomPrivateValue(),
    score: 0n,
    scoreSalt: randomPrivateValue(),
    applicantSecret: randomPrivateValue(),
    applicantIncomeBand: 0n,
    applicantGpaScaled: 0n,
    applicantRegionCode: 0n,
    applicantSalt: new Uint8Array(PRIVATE_VALUE_LENGTH),
  });

export type BrowserAequiraDeployment = {
  readonly address: string;
  readonly contract: FoundAequiraContract;
  /** Generated here, so it need not be read back from an indexer that lags. */
  readonly roundId: Uint8Array;
  readonly session: BrowserProviderSession;
};

export const deployNewAequira = async (
  connectedApi: ConnectedAPI,
  privateStatePassword: string,
  thresholds: EligibilityThresholds,
): Promise<BrowserAequiraDeployment> => {
  const session = await createBrowserProviderSession(connectedApi, privateStatePassword);

  try {
    const roundId = randomPrivateValue();
    const contract = await withDeploymentStage('contract-deployment', () =>
      deployAequira(session.providers, {
        privateState: createRandomPrivateState(),
        roundId,
        maxIncomeBand: thresholds.maxIncomeBand,
        minGpaScaled: thresholds.minGpaScaled,
      }),
    );

    return {
      address: contract.deployTxData.public.contractAddress,
      contract,
      roundId,
      session,
    };
  } catch (error) {
    await session.close();
    throw error;
  }
};
