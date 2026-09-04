import { createAequiraPrivateState, deployAequira, type FoundAequiraContract } from '@aequira/sdk';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';

import { createBrowserProviderSession, type BrowserProviderSession } from './browser-providers.js';
import { withDeploymentStage } from './deployment-errors.js';
import type { EligibilityThresholds } from './round-inputs.js';

const PRIVATE_VALUE_LENGTH = 32;

const randomPrivateValue = (): Uint8Array =>
  crypto.getRandomValues(new Uint8Array(PRIVATE_VALUE_LENGTH));

export type BrowserAequiraDeployment = {
  readonly address: string;
  readonly contract: FoundAequiraContract;
  readonly session: BrowserProviderSession;
};

export const deployNewAequira = async (
  connectedApi: ConnectedAPI,
  privateStatePassword: string,
  thresholds: EligibilityThresholds,
): Promise<BrowserAequiraDeployment> => {
  const session = await createBrowserProviderSession(connectedApi, privateStatePassword);

  try {
    const privateState = createAequiraPrivateState({
      adminSecret: randomPrivateValue(),
      reviewerSecret: randomPrivateValue(),
      score: 0n,
      scoreSalt: randomPrivateValue(),
      applicantSecret: randomPrivateValue(),
      applicantIncomeBand: 0n,
      applicantGpaScaled: 0n,
      applicantRegionCode: 0n,
      applicantSalt: randomPrivateValue(),
    });
    const contract = await withDeploymentStage('contract-deployment', () =>
      deployAequira(session.providers, {
        privateState,
        roundId: randomPrivateValue(),
        maxIncomeBand: thresholds.maxIncomeBand,
        minGpaScaled: thresholds.minGpaScaled,
      }),
    );

    return {
      address: contract.deployTxData.public.contractAddress,
      contract,
      session,
    };
  } catch (error) {
    await session.close();
    throw error;
  }
};
