import type { AequiraRound } from '../../hooks/useAequiraRound.js';
import { actionAvailability, PHASE } from '../../round-actions.js';
import type { PhaseTransition } from '../../round.js';
import { ActionButton } from '../ActionButton.js';

// The contract only allows each transition from one phase, so the button that is
// offered is derived from the phase rather than always showing all three.
const NEXT_TRANSITION: Record<number, { readonly label: string; readonly to: PhaseTransition }> = {
  [PHASE.SETUP]: { label: 'Open applications', to: 'openApplications' },
  [PHASE.APPLY]: { label: 'Open review', to: 'openReview' },
  [PHASE.REVIEW]: { label: 'Open reveal', to: 'openReveal' },
};

type AdvanceStepProps = {
  readonly round: AequiraRound;
};

export const AdvanceStep = ({ round }: AdvanceStepProps) => {
  const phase = round.view?.phase ?? null;
  const availability = actionAvailability('advance', {
    busy: round.busy !== null,
    local: round.local,
    phase,
  });
  const next = phase === null ? undefined : NEXT_TRANSITION[phase];

  if (next === undefined) {
    return (
      <p className="field-hint">
        {phase === null ? 'Waiting for the public ledger.' : 'The round is in its last phase.'}
      </p>
    );
  }

  return (
    <ActionButton
      availability={availability}
      busy={round.busy === 'phase'}
      busyLabel="Advancing…"
      onClick={() => void round.advance(next.to)}
      variant="primary"
    >
      {next.label}
    </ActionButton>
  );
};
