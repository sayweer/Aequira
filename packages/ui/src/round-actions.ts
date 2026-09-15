// Pure rules for what a browser can do at each point of a round, and why not
// when it cannot. The contract enforces all of this anyway; deciding it here
// lets the page say so before a proof is spent, instead of after.
//
// Compiled by the test build, so it imports nothing but other pure modules.

import type { LocalStatus } from './round-format.js';

export const PHASE = {
  SETUP: 0,
  APPLY: 1,
  REVIEW: 2,
  REVEAL: 3,
} as const;

export type RoundRole = 'applicant' | 'organizer' | 'reviewer';

export type StepState = 'current' | 'done' | 'upcoming';

export type PhaseStep = {
  readonly label: string;
  readonly state: StepState;
};

const STEP_LABELS = ['Setup', 'Applications', 'Review', 'Reveal'];

export const phaseSteps = (phase: number | null): readonly PhaseStep[] =>
  STEP_LABELS.map((label, index) => ({
    label,
    state: phase === null || index > phase ? 'upcoming' : index === phase ? 'current' : 'done',
  }));

/** The role whose panel the current phase is waiting on. */
export const focusRole = (phase: number | null): RoundRole => {
  if (phase === PHASE.APPLY) {
    return 'applicant';
  }
  if (phase === PHASE.REVIEW || phase === PHASE.REVEAL) {
    return 'reviewer';
  }
  return 'organizer';
};

export type RoundAction =
  | 'advance'
  | 'apply'
  | 'commit'
  | 'importReceipt'
  | 'registerApplicant'
  | 'registerReviewer'
  | 'reveal';

export type Availability = {
  readonly enabled: boolean;
  /** Why the action is unavailable; null when it is available or merely waiting. */
  readonly reason: string | null;
};

export type AvailabilityInput = {
  readonly busy: boolean;
  readonly local: LocalStatus | null;
  readonly phase: number | null;
};

const available: Availability = { enabled: true, reason: null };
const blocked = (reason: string | null): Availability => ({ enabled: false, reason });

const ONLY_ADMIN = 'Only the wallet that deployed this round can do this.';

const decide = (action: RoundAction, phase: number, local: LocalStatus): Availability => {
  switch (action) {
    case 'registerReviewer':
    case 'registerApplicant':
      if (phase !== PHASE.SETUP) {
        return blocked('Registration closes when applications open.');
      }
      return local.isAdmin ? available : blocked(ONLY_ADMIN);

    case 'advance':
      if (!local.isAdmin) {
        return blocked(ONLY_ADMIN);
      }
      return phase < PHASE.REVEAL ? available : blocked('The round is in its last phase.');

    case 'importReceipt':
      if (local.hasApplied) {
        return blocked('You have already applied; the enrollment can no longer change.');
      }
      return phase <= PHASE.APPLY ? available : blocked('Enrollment closed when review opened.');

    case 'apply':
      if (local.hasApplied) {
        return blocked('You have already applied to this round.');
      }
      if (phase < PHASE.APPLY) {
        return blocked('Applications open after setup.');
      }
      if (phase > PHASE.APPLY) {
        return blocked('Applications are closed.');
      }
      if (!local.receiptImported) {
        return blocked('Import the enrollment receipt from the institution first.');
      }
      return local.enrolledOnChain
        ? available
        : blocked('Your enrollment is not on chain yet. Ask the institution to register it.');

    case 'commit':
      if (phase !== PHASE.REVIEW) {
        return blocked(
          phase < PHASE.REVIEW
            ? 'Scoring opens with review.'
            : 'Scoring closed when reveal opened.',
        );
      }
      return local.isRegisteredReviewer
        ? available
        : blocked('This browser’s reviewer pseudonym is not on the roster.');

    case 'reveal':
      return phase === PHASE.REVEAL ? available : blocked('Scores open during reveal.');
  }
};

export const actionAvailability = (
  action: RoundAction,
  { busy, local, phase }: AvailabilityInput,
): Availability => {
  if (phase === null) {
    return blocked('Waiting for the public ledger.');
  }
  if (local === null) {
    return blocked('This browser holds no secrets for this round.');
  }
  if (busy) {
    return blocked(null);
  }
  return decide(action, phase, local);
};
