// The round as an ordered walk, one step at a time.
//
// The panels used to offer every action a phase allowed, side by side. That let
// a round advance out of setup with no reviewer registered, which cannot be
// undone: registration is setup-only, so the round reached reveal with no
// commitment and every score was refused. Nothing in the contract was wrong —
// the interface simply let a required step be skipped.
//
// So the flow is derived rather than laid out: each step reports whether it is
// already done from the public ledger and this browser's own state, and the one
// on screen is the first that is not. A step cannot be reached before the ones
// it depends on, because those are what mark it reachable.

import type { LastScore } from './privacy-view.js';
import { PHASE } from './round-actions.js';
import type { LocalStatus } from './round-format.js';

export type RoundStepId =
  | 'apply'
  | 'commit'
  | 'enrollment'
  | 'openApplications'
  | 'openReveal'
  | 'openReview'
  | 'receipt'
  | 'register'
  | 'reveal'
  | 'round'
  | 'wallet';

export type RoundStepInput = {
  /** True once a wallet session is live. */
  readonly connected: boolean;
  /** The contract this browser holds secrets for, or null before a round opens. */
  readonly address: string | null;
  /** Commitments currently sealed on chain; reveal removes one. */
  readonly commitmentHexes: readonly string[];
  readonly lastScore: LastScore | null;
  readonly local: LocalStatus | null;
  readonly phase: number | null;
};

export type RoundStep = {
  readonly id: RoundStepId;
  /** What this step is called on screen. */
  readonly title: string;
  /** One line saying what it accomplishes, shown under the title. */
  readonly summary: string;
  readonly done: boolean;
};

type StepDefinition = {
  readonly id: RoundStepId;
  readonly title: string;
  readonly summary: string;
  /**
   * The last phase in which this step can still be taken. A round that moves
   * past it without the step being done can never be finished: registration is
   * setup-only, applying closes with the phase, and scoring closes when reveal
   * opens. Steps without a deadline are left undefined.
   */
  readonly closesAfter?: number;
  isDone(input: RoundStepInput): boolean;
};

const atLeast = (phase: number | null, target: number): boolean =>
  phase !== null && phase >= target;

const DEFINITIONS: readonly StepDefinition[] = [
  {
    id: 'wallet',
    title: 'Connect your wallet',
    summary: 'Lace signs and pays for every call. AEQUIRA never sees a key.',
    isDone: ({ connected }) => connected,
  },
  {
    id: 'round',
    title: 'Open a round',
    summary: 'Deploy a new round, or join one the organizer shared.',
    isDone: ({ address }) => address !== null,
  },
  {
    id: 'register',
    closesAfter: PHASE.SETUP,
    title: 'Register the reviewer',
    summary: 'Only registered pseudonyms can seal a score, and only setup can register them.',
    isDone: ({ local }) => local?.isRegisteredReviewer === true,
  },
  {
    id: 'enrollment',
    closesAfter: PHASE.SETUP,
    title: 'Enroll an applicant',
    summary: 'The figures you verified go into a commitment and a private receipt, never on chain.',
    isDone: ({ local }) => local?.enrolledOnChain === true,
  },
  {
    id: 'receipt',
    closesAfter: PHASE.APPLY,
    title: 'Import the receipt',
    summary: 'The applicant needs the receipt before they can prove they clear the rules.',
    isDone: ({ local }) => local?.receiptImported === true,
  },
  {
    id: 'openApplications',
    title: 'Open applications',
    summary: 'Setup closes here. Nothing above can be added to the round afterwards.',
    isDone: ({ phase }) => atLeast(phase, PHASE.APPLY),
  },
  {
    id: 'apply',
    closesAfter: PHASE.APPLY,
    title: 'Submit the application',
    summary: 'The proof shows the rules are met. The ledger gets a pseudonym and nothing else.',
    isDone: ({ local }) => local?.hasApplied === true,
  },
  {
    id: 'openReview',
    title: 'Open review',
    summary: 'Scoring opens.',
    isDone: ({ phase }) => atLeast(phase, PHASE.REVIEW),
  },
  {
    id: 'commit',
    closesAfter: PHASE.REVIEW,
    title: 'Seal a score',
    summary: 'The commitment goes public. The score stays in this browser.',
    // A commit that has been made is known here before the indexer catches up,
    // and a revealed score was committed first.
    isDone: ({ lastScore }) => lastScore !== null,
  },
  {
    id: 'openReveal',
    title: 'Open reveal',
    summary: 'Sealed scores can now be opened into the tally.',
    isDone: ({ phase }) => atLeast(phase, PHASE.REVEAL),
  },
  {
    id: 'reveal',
    title: 'Open the sealed score',
    summary: 'The tally moves to match the score anyone can now recompute.',
    isDone: ({ lastScore }) => lastScore?.stage === 'revealed',
  },
];

export const roundSteps = (input: RoundStepInput): readonly RoundStep[] =>
  DEFINITIONS.map(({ id, title, summary, isDone }) => ({
    id,
    title,
    summary,
    done: isDone(input),
  }));

/**
 * The step to show: the first one that is not done, or null once the round is
 * walked through. Order is the dependency, so a later step is never offered
 * while an earlier one is outstanding.
 */
export const currentRoundStep = (input: RoundStepInput): RoundStep | null =>
  roundSteps(input).find((step) => !step.done) ?? null;

/** Position of the step on screen, counted from one, for "step 3 of 11". */
export const roundStepPosition = (id: RoundStepId): number =>
  DEFINITIONS.findIndex((definition) => definition.id === id) + 1;

export const ROUND_STEP_COUNT = DEFINITIONS.length;

/**
 * The step this round can no longer take, or null while it is still finishable.
 *
 * Phases only move forward, so a step left undone past its deadline strands the
 * round. Saying so is the difference between a dead form and an explanation.
 */
export const unreachableRoundStep = (input: RoundStepInput): RoundStep | null => {
  const { phase } = input;

  if (phase === null) {
    return null;
  }

  const stranded = DEFINITIONS.find(
    (definition) =>
      definition.closesAfter !== undefined &&
      phase > definition.closesAfter &&
      !definition.isDone(input),
  );

  if (stranded === undefined) {
    return null;
  }

  return {
    id: stranded.id,
    title: stranded.title,
    summary: stranded.summary,
    done: false,
  };
};
