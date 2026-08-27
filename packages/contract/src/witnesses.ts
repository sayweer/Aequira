import type { MerkleTreePath } from '@midnight-ntwrk/compact-runtime';
import type { WitnessContext } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';

import { pureCircuits, type Ledger } from './managed/aequira/contract/index.js';

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
  /**
   * Looks up this reviewer's own membership path in the public tree.
   *
   * The path is taken from the ledger rather than stored privately, so there is
   * no local copy to go stale, and no hand-written Merkle code to get wrong.
   * `commitScore` still asserts that the returned leaf is this reviewer's own
   * pseudonym, so a path fetched for anyone else is refused by the circuit.
   */
  reviewerMerklePath: ({
    ledger,
    privateState,
  }: WitnessContext<Ledger, AequiraPrivateState>): [
    AequiraPrivateState,
    MerkleTreePath<Uint8Array>,
  ] => {
    const leaf = pureCircuits.reviewerId(privateState.reviewerSecret);
    const path = ledger.reviewerTree.findPathForLeaf(leaf);

    if (path === undefined) {
      // Names no secret: the pseudonym is derived from one, and the round's
      // roster is public anyway.
      throw new Error('This reviewer is not registered in the round');
    }

    return [privateState, path];
  },
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
