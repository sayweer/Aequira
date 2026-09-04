import type { MerkleTreePath } from '@midnight-ntwrk/compact-runtime';
import type { WitnessContext } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';

import { pureCircuits, type Ledger } from './managed/aequira/contract/index.js';

export type AequiraPrivateState = {
  readonly adminSecret: Uint8Array;
  readonly reviewerSecret: Uint8Array;
  readonly score: bigint;
  readonly scoreSalt: Uint8Array;
  /**
   * The applicant half of the round. It is held beside the reviewer half rather
   * than in a separate store because one encrypted private state exists per
   * contract per person, and the same person may hold both roles.
   *
   * The attributes and salt are not chosen locally: they are what the
   * institution verified and committed to at enrollment, and `apply` recomputes
   * the enrollment leaf from them, so values that were never enrolled produce a
   * leaf that is in no tree.
   */
  readonly applicantSecret: Uint8Array;
  readonly applicantIncomeBand: bigint;
  readonly applicantGpaScaled: bigint;
  readonly applicantRegionCode: bigint;
  readonly applicantSalt: Uint8Array;
};

/**
 * Takes a single object rather than positional arguments: the state now holds
 * nine fields, four of which are 32-byte arrays that no call site could tell
 * apart in a positional list.
 */
export const createAequiraPrivateState = (values: AequiraPrivateState): AequiraPrivateState => ({
  adminSecret: values.adminSecret,
  reviewerSecret: values.reviewerSecret,
  score: values.score,
  scoreSalt: values.scoreSalt,
  applicantSecret: values.applicantSecret,
  applicantIncomeBand: values.applicantIncomeBand,
  applicantGpaScaled: values.applicantGpaScaled,
  applicantRegionCode: values.applicantRegionCode,
  applicantSalt: values.applicantSalt,
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
  applicantSecret: ({
    privateState,
  }: WitnessContext<Ledger, AequiraPrivateState>): [AequiraPrivateState, Uint8Array] => [
    privateState,
    privateState.applicantSecret,
  ],
  applicantIncomeBand: ({
    privateState,
  }: WitnessContext<Ledger, AequiraPrivateState>): [AequiraPrivateState, bigint] => [
    privateState,
    privateState.applicantIncomeBand,
  ],
  applicantGpaScaled: ({
    privateState,
  }: WitnessContext<Ledger, AequiraPrivateState>): [AequiraPrivateState, bigint] => [
    privateState,
    privateState.applicantGpaScaled,
  ],
  applicantRegionCode: ({
    privateState,
  }: WitnessContext<Ledger, AequiraPrivateState>): [AequiraPrivateState, bigint] => [
    privateState,
    privateState.applicantRegionCode,
  ],
  applicantSalt: ({
    privateState,
  }: WitnessContext<Ledger, AequiraPrivateState>): [AequiraPrivateState, Uint8Array] => [
    privateState,
    privateState.applicantSalt,
  ],
  /**
   * The applicant's own enrollment path, looked up in the public tree.
   *
   * Same shape as `reviewerMerklePath`: the path comes from the ledger so there
   * is no local copy to go stale and no hand-written Merkle code to get wrong.
   * `apply` still recomputes the leaf from these witnesses and asserts it
   * matches, so a path fetched for anyone else is refused by the circuit.
   */
  applicantMerklePath: ({
    ledger,
    privateState,
  }: WitnessContext<Ledger, AequiraPrivateState>): [
    AequiraPrivateState,
    MerkleTreePath<Uint8Array>,
  ] => {
    const leaf = pureCircuits.applicantLeaf(
      privateState.applicantIncomeBand,
      privateState.applicantGpaScaled,
      privateState.applicantRegionCode,
      privateState.applicantSecret,
      privateState.applicantSalt,
    );
    const path = ledger.applicantTree.findPathForLeaf(leaf);

    if (path === undefined) {
      // Names no attribute and no secret: it says only that no enrollment
      // commitment in the public tree opens to what this client holds.
      throw new Error('This applicant is not enrolled in the round');
    }

    return [privateState, path];
  },
};
