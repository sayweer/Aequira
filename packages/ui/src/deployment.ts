import { createAequiraPrivateState, deployAequira, type FoundAequiraContract } from '@aequira/sdk';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';

import { createBrowserProviderSession, type BrowserProviderSession } from './browser-providers.js';

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
): Promise<BrowserAequiraDeployment> => {
  const session = await createBrowserProviderSession(connectedApi, privateStatePassword);

  try {
    const privateState = createAequiraPrivateState(
      randomPrivateValue(),
      randomPrivateValue(),
      0n,
      randomPrivateValue(),
    );
    const contract = await deployAequira(session.providers, {
      privateState,
      roundId: randomPrivateValue(),
    });

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
