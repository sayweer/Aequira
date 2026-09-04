import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum Phase { SETUP = 0,
                    APPLY = 1,
                    REVIEW = 2,
                    REVEAL = 3,
                    FINALIZED = 4,
                    CLAIMED = 5
}

export type Witnesses<PS> = {
  adminSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  reviewerSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  reviewerMerklePath(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, { leaf: Uint8Array,
                                                                                   path: { sibling: { field: bigint
                                                                                                    },
                                                                                           goes_left: boolean
                                                                                         }[]
                                                                                 }];
  reviewScore(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  reviewSalt(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  applicantSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  applicantIncomeBand(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  applicantGpaScaled(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  applicantRegionCode(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  applicantSalt(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  applicantMerklePath(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, { leaf: Uint8Array,
                                                                                    path: { sibling: { field: bigint
                                                                                                     },
                                                                                            goes_left: boolean
                                                                                          }[]
                                                                                  }];
}

export type ImpureCircuits<PS> = {
  registerReviewer(context: __compactRuntime.CircuitContext<PS>,
                   id_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  registerApplicant(context: __compactRuntime.CircuitContext<PS>,
                    leaf_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  openApplications(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  openReview(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  openReveal(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  apply(context: __compactRuntime.CircuitContext<PS>, nonce_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  commitScore(context: __compactRuntime.CircuitContext<PS>,
              applicationId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revealScore(context: __compactRuntime.CircuitContext<PS>,
              applicationId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  registerReviewer(context: __compactRuntime.CircuitContext<PS>,
                   id_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  registerApplicant(context: __compactRuntime.CircuitContext<PS>,
                    leaf_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  openApplications(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  openReview(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  openReveal(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  apply(context: __compactRuntime.CircuitContext<PS>, nonce_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  commitScore(context: __compactRuntime.CircuitContext<PS>,
              applicationId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revealScore(context: __compactRuntime.CircuitContext<PS>,
              applicationId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  adminId(activeRoundId_0: Uint8Array, secret_0: Uint8Array): Uint8Array;
  reviewerId(secret_0: Uint8Array): Uint8Array;
  scoreNullifier(activeRoundId_0: Uint8Array,
                 applicationId_0: Uint8Array,
                 secret_0: Uint8Array): Uint8Array;
  scoreCommitment(activeRoundId_0: Uint8Array,
                  applicationId_0: Uint8Array,
                  score_0: bigint,
                  secret_0: Uint8Array,
                  salt_0: Uint8Array): Uint8Array;
  applicantId(secret_0: Uint8Array): Uint8Array;
  applicantLeaf(incomeBand_0: bigint,
                gpaScaled_0: bigint,
                regionCode_0: bigint,
                secret_0: Uint8Array,
                salt_0: Uint8Array): Uint8Array;
  applyNullifier(activeRoundId_0: Uint8Array, secret_0: Uint8Array): Uint8Array;
  applicationPseudonym(activeRoundId_0: Uint8Array,
                       secret_0: Uint8Array,
                       nonce_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  adminId(context: __compactRuntime.CircuitContext<PS>,
          activeRoundId_0: Uint8Array,
          secret_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  reviewerId(context: __compactRuntime.CircuitContext<PS>, secret_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  scoreNullifier(context: __compactRuntime.CircuitContext<PS>,
                 activeRoundId_0: Uint8Array,
                 applicationId_0: Uint8Array,
                 secret_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  scoreCommitment(context: __compactRuntime.CircuitContext<PS>,
                  activeRoundId_0: Uint8Array,
                  applicationId_0: Uint8Array,
                  score_0: bigint,
                  secret_0: Uint8Array,
                  salt_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  applicantId(context: __compactRuntime.CircuitContext<PS>, secret_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  applicantLeaf(context: __compactRuntime.CircuitContext<PS>,
                incomeBand_0: bigint,
                gpaScaled_0: bigint,
                regionCode_0: bigint,
                secret_0: Uint8Array,
                salt_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  applyNullifier(context: __compactRuntime.CircuitContext<PS>,
                 activeRoundId_0: Uint8Array,
                 secret_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  applicationPseudonym(context: __compactRuntime.CircuitContext<PS>,
                       activeRoundId_0: Uint8Array,
                       secret_0: Uint8Array,
                       nonce_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  registerReviewer(context: __compactRuntime.CircuitContext<PS>,
                   id_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  registerApplicant(context: __compactRuntime.CircuitContext<PS>,
                    leaf_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  openApplications(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  openReview(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  openReveal(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  apply(context: __compactRuntime.CircuitContext<PS>, nonce_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  commitScore(context: __compactRuntime.CircuitContext<PS>,
              applicationId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revealScore(context: __compactRuntime.CircuitContext<PS>,
              applicationId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly phase: Phase;
  readonly roundId: Uint8Array;
  readonly adminAuthority: Uint8Array;
  reviewers: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  reviewerTree: {
    isFull(): boolean;
    checkRoot(rt_0: { field: bigint }): boolean;
    root(): __compactRuntime.MerkleTreeDigest;
    firstFree(): bigint;
    pathForLeaf(index_0: bigint, leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array>;
    findPathForLeaf(leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array> | undefined
  };
  scoreNullifiers: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  scoreCommitments: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  scoreSums: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): { read(): bigint }
  };
  revealedCounts: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): { read(): bigint }
  };
  readonly maxIncomeBand: bigint;
  readonly minGpaScaled: bigint;
  applicantTree: {
    isFull(): boolean;
    checkRoot(rt_0: { field: bigint }): boolean;
    root(): __compactRuntime.MerkleTreeDigest;
    firstFree(): bigint;
    pathForLeaf(index_0: bigint, leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array>;
    findPathForLeaf(leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array> | undefined
  };
  applyNullifiers: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  applications: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               initialRoundId_0: Uint8Array,
               initialAdminSecret_0: Uint8Array,
               initialMaxIncomeBand_0: bigint,
               initialMinGpaScaled_0: bigint): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
