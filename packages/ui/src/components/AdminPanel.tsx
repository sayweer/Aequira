import { useEffect, useState } from 'react';

import type { AequiraRound } from '../hooks/useAequiraRound.js';
import type { PhaseTransition } from '../round.js';

// The contract only allows each transition from one phase, so the button that is
// offered is derived from the phase rather than always showing all three.
const NEXT_TRANSITION: Record<number, { readonly label: string; readonly to: PhaseTransition }> = {
  0: { label: 'Open applications', to: 'openApplications' },
  1: { label: 'Open review', to: 'openReview' },
  2: { label: 'Open reveal', to: 'openReveal' },
};

type AdminPanelProps = {
  readonly round: AequiraRound;
};

export const AdminPanel = ({ round }: AdminPanelProps) => {
  const [reviewerIdInput, setReviewerIdInput] = useState('');

  // Registering anything other than the pseudonym derived from this browser's own
  // reviewer secret would make commitScore fail its membership assertion, so the
  // field is prefilled with it.
  useEffect(() => {
    if (round.reviewerIdHex !== null) {
      setReviewerIdInput((current) => (current.length === 0 ? round.reviewerIdHex! : current));
    }
  }, [round.reviewerIdHex]);

  const phase = round.view?.phase;
  const next = phase === undefined ? undefined : NEXT_TRANSITION[phase];
  const busy = round.busy !== null;

  return (
    <section className="round-card" aria-labelledby="admin-heading">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Organizer</p>
          <h3 id="admin-heading">Round setup</h3>
        </div>
      </div>

      <label className="field">
        <span>Reviewer pseudonym</span>
        <input
          autoComplete="off"
          disabled={busy || phase !== 0}
          onChange={(event) => setReviewerIdInput(event.target.value)}
          placeholder="64 hexadecimal characters"
          spellCheck={false}
          type="text"
          value={reviewerIdInput}
        />
      </label>
      <p className="privacy-note">
        This is the one-way hash of this browser’s reviewer secret. Registering it authorizes the
        reviewer without publishing the secret.
      </p>

      <div className="button-row">
        <button
          aria-busy={round.busy === 'register'}
          className="button button-secondary"
          disabled={busy || phase !== 0 || reviewerIdInput.trim().length === 0}
          onClick={() => void round.registerReviewer(reviewerIdInput)}
          type="button"
        >
          {round.busy === 'register' ? 'Registering…' : 'Register reviewer'}
        </button>

        {next !== undefined && (
          <button
            aria-busy={round.busy === 'phase'}
            className="button button-primary"
            disabled={busy}
            onClick={() => void round.advance(next.to)}
            type="button"
          >
            {round.busy === 'phase' ? 'Advancing…' : next.label}
          </button>
        )}
      </div>

      {phase !== undefined && phase >= 3 && (
        <p className="privacy-note">
          The round has reached its final implemented phase. Transitions are one-way.
        </p>
      )}
    </section>
  );
};
