import type { AequiraPrivateState, Contract, Witnesses } from '@aequira/contract';
import type { FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';

export const AEQUIRA_PRIVATE_STATE_ID = 'aequiraPrivateState';

export type AequiraContract = Contract<AequiraPrivateState, Witnesses<AequiraPrivateState>>;

export type AequiraCircuitKey = Exclude<keyof AequiraContract['impureCircuits'], number | symbol>;

export type AequiraPrivateStateId = typeof AEQUIRA_PRIVATE_STATE_ID;

export type AequiraProviders = MidnightProviders<
  AequiraCircuitKey,
  AequiraPrivateStateId,
  AequiraPrivateState
>;

export type FoundAequiraContract = FoundContract<AequiraContract>;
