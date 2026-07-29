import type { WitnessContext } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';

import type { Ledger } from './managed/aequira/contract/index.js';

export type AequiraPrivateState = {
  readonly adminSecret: Uint8Array;
  readonly reviewerSecret: Uint8Array;
  readonly score: bigint;
  readonly scoreSalt: Uint8Array;
};

export const createAequiraPrivateState = (
  adminSecret: Uint8Array,
  reviewerSecret: Uint8Array,
  score: bigint,
  scoreSalt: Uint8Array,
): AequiraPrivateState => ({
  adminSecret,
  reviewerSecret,
  score,
  scoreSalt,
});

export const witnesses = {
  adminSecret: ({
    privateState,
  }: WitnessContext<Ledger, AequiraPrivateState>): [AequiraPrivateState, Uint8Array] => [
    privateState,
    privateState.adminSecret,
  ],
  reviewerSecret: ({
    privateState,
  }: WitnessContext<Ledger, AequiraPrivateState>): [AequiraPrivateState, Uint8Array] => [
    privateState,
    privateState.reviewerSecret,
  ],
  reviewScore: ({
    privateState,
  }: WitnessContext<Ledger, AequiraPrivateState>): [AequiraPrivateState, bigint] => [
    privateState,
    privateState.score,
  ],
  reviewSalt: ({
    privateState,
  }: WitnessContext<Ledger, AequiraPrivateState>): [AequiraPrivateState, Uint8Array] => [
    privateState,
    privateState.scoreSalt,
  ],
};
