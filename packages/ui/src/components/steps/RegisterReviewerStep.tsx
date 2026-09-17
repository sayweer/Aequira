import { useEffect, useState } from 'react';

import type { AequiraRound } from '../../hooks/useAequiraRound.js';
import { actionAvailability } from '../../round-actions.js';
import { ActionButton } from '../ActionButton.js';

type RegisterReviewerStepProps = {
  readonly round: AequiraRound;
};

export const RegisterReviewerStep = ({ round }: RegisterReviewerStepProps) => {
  const [reviewerIdInput, setReviewerIdInput] = useState('');

  const ownReviewerId = round.identity?.reviewerIdHex ?? null;

  // Registering anything other than the pseudonym derived from this browser's own
  // reviewer secret would make commitScore fail its membership assertion, so the
  // field starts with it.
  useEffect(() => {
    if (ownReviewerId !== null) {
      setReviewerIdInput((current) => (current.length === 0 ? ownReviewerId : current));
    }
  }, [ownReviewerId]);

  const availability = actionAvailability('registerReviewer', {
    busy: round.busy !== null,
    local: round.local,
    phase: round.view?.phase ?? null,
  });

  return (
    <>
      <label className="field">
        <span className="field-label">Reviewer pseudonym</span>
        <input
          autoComplete="off"
          className="mono"
          disabled={!availability.enabled}
          onChange={(event) => setReviewerIdInput(event.target.value)}
          placeholder="64 hex characters"
          spellCheck={false}
          type="text"
          value={reviewerIdInput}
        />
        <span className="field-hint">
          Starts with this browser’s own pseudonym, a one-way hash of its reviewer secret.
        </span>
      </label>
      <ActionButton
        availability={availability}
        busy={round.busy === 'register'}
        busyLabel="Registering…"
        disabled={reviewerIdInput.trim().length === 0}
        onClick={() => void round.registerReviewer(reviewerIdInput)}
        variant="primary"
      >
        Register reviewer
      </ActionButton>
    </>
  );
};
