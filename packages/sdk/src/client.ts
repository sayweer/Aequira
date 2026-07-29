import {
  compiledAequiraContract,
  ledger,
  type AequiraPrivateState,
  type Ledger,
} from '@aequira/contract';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';

import {
  AEQUIRA_PRIVATE_STATE_ID,
  type AequiraContract,
  type AequiraProviders,
  type FoundAequiraContract,
} from './types.js';

const BYTE_LENGTH = 32;

const assertBytes32 = (name: string, value: Uint8Array): void => {
  if (value.byteLength !== BYTE_LENGTH) {
    throw new RangeError(`${name} must contain exactly ${BYTE_LENGTH} bytes`);
  }
};

export const validateAequiraPrivateState = (privateState: AequiraPrivateState): void => {
  assertBytes32('adminSecret', privateState.adminSecret);
  assertBytes32('reviewerSecret', privateState.reviewerSecret);
  assertBytes32('scoreSalt', privateState.scoreSalt);

  if (privateState.score < 0n || privateState.score > 100n) {
    throw new RangeError('score must be between 0 and 100');
  }
};

export type DeployAequiraOptions = {
  readonly roundId: Uint8Array;
  readonly privateState: AequiraPrivateState;
};

export const deployAequira = async (
  providers: AequiraProviders,
  options: DeployAequiraOptions,
): Promise<FoundAequiraContract> => {
  assertBytes32('roundId', options.roundId);
  validateAequiraPrivateState(options.privateState);

  const deployed = await deployContract<AequiraContract>(providers, {
    compiledContract: compiledAequiraContract,
    privateStateId: AEQUIRA_PRIVATE_STATE_ID,
    initialPrivateState: options.privateState,
    args: [options.roundId, options.privateState.adminSecret],
  });

  providers.privateStateProvider.setContractAddress(deployed.deployTxData.public.contractAddress);

  return deployed;
};

export type JoinAequiraOptions = {
  readonly contractAddress: ContractAddress;
  readonly initialPrivateState?: AequiraPrivateState;
};

export const joinAequira = async (
  providers: AequiraProviders,
  options: JoinAequiraOptions,
): Promise<FoundAequiraContract> => {
  if (options.initialPrivateState !== undefined) {
    validateAequiraPrivateState(options.initialPrivateState);
  }

  const commonOptions = {
    compiledContract: compiledAequiraContract,
    contractAddress: options.contractAddress,
    privateStateId: AEQUIRA_PRIVATE_STATE_ID,
  };

  const found =
    options.initialPrivateState === undefined
      ? await findDeployedContract<AequiraContract>(providers, commonOptions)
      : await findDeployedContract<AequiraContract>(providers, {
          ...commonOptions,
          initialPrivateState: options.initialPrivateState,
        });

  providers.privateStateProvider.setContractAddress(options.contractAddress);

  return found;
};

export const setAequiraPrivateState = async (
  providers: AequiraProviders,
  contractAddress: ContractAddress,
  privateState: AequiraPrivateState,
): Promise<void> => {
  validateAequiraPrivateState(privateState);
  providers.privateStateProvider.setContractAddress(contractAddress);
  await providers.privateStateProvider.set(AEQUIRA_PRIVATE_STATE_ID, privateState);
};

export const queryAequiraLedger = async (
  providers: AequiraProviders,
  contractAddress: ContractAddress,
): Promise<Ledger | null> => {
  const contractState = await providers.publicDataProvider.queryContractState(contractAddress);

  return contractState === null ? null : ledger(contractState.data);
};
