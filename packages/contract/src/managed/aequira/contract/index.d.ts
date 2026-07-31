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
  reviewScore(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  reviewSalt(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  registerReviewer(context: __compactRuntime.CircuitContext<PS>,
                   id_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  openApplications(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  openReview(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  openReveal(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  commitScore(context: __compactRuntime.CircuitContext<PS>,
              applicationId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revealScore(context: __compactRuntime.CircuitContext<PS>,
              applicationId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  registerReviewer(context: __compactRuntime.CircuitContext<PS>,
                   id_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  openApplications(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  openReview(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  openReveal(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
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
  registerReviewer(context: __compactRuntime.CircuitContext<PS>,
                   id_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  openApplications(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  openReview(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  openReveal(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
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
               initialAdminSecret_0: Uint8Array): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
