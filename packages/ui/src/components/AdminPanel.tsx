import { useEffect, useState } from 'react';

import type { AequiraRound } from '../hooks/useAequiraRound.js';
import { actionAvailability, PHASE } from '../round-actions.js';
import type { PhaseTransition } from '../round.js';
import { CopyButton } from './CopyButton.js';
import { StageMessage } from './StageMessage.js';

// The contract only allows each transition from one phase, so the button that is
// offered is derived from the phase rather than always showing all three.
const NEXT_TRANSITION: Record<number, { readonly label: string; readonly to: PhaseTransition }> = {
  [PHASE.SETUP]: { label: 'Open applications', to: 'openApplications' },
  [PHASE.APPLY]: { label: 'Open review', to: 'openReview' },
  [PHASE.REVIEW]: { label: 'Open reveal', to: 'openReveal' },
};

type AdminPanelProps = {
  readonly round: AequiraRound;
};

export const AdminPanel = ({ round }: AdminPanelProps) => {
  const [reviewerIdInput, setReviewerIdInput] = useState('');
  const [applicantIdInput, setApplicantIdInput] = useState('');
  const [incomeBandInput, setIncomeBandInput] = useState('');
  const [gpaScaledInput, setGpaScaledInput] = useState('');
  const [regionCodeInput, setRegionCodeInput] = useState('');

  const ownReviewerId = round.identity?.reviewerIdHex ?? null;
  const ownApplicantId = round.identity?.applicantIdHex ?? null;

  // Registering anything other than the pseudonym derived from this browser's own
  // reviewer secret would make commitScore fail its membership assertion, so the
  // field starts with it.
  useEffect(() => {
    if (ownReviewerId !== null) {
      setReviewerIdInput((current) => (current.length === 0 ? ownReviewerId : current));
    }
  }, [ownReviewerId]);

  const phase = round.view?.phase ?? null;
  const context = { busy: round.busy !== null, local: round.local, phase };
  const reviewer = actionAvailability('registerReviewer', context);
  const applicant = actionAvailability('registerApplicant', context);
  const advance = actionAvailability('advance', context);
  const next = phase === null ? undefined : NEXT_TRANSITION[phase];
  const errorText = round.errorFor(['register', 'registerApplicant', 'phase']);

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
          disabled={!reviewer.enabled}
          onChange={(event) => setReviewerIdInput(event.target.value)}
          placeholder="64 hexadecimal characters"
          spellCheck={false}
          type="text"
          value={reviewerIdInput}
        />
      </label>
      <button
        aria-busy={round.busy === 'register'}
        className="button button-secondary"
        disabled={!reviewer.enabled || reviewerIdInput.trim().length === 0}
        onClick={() => void round.registerReviewer(reviewerIdInput)}
        type="button"
      >
        {round.busy === 'register' ? 'Registering…' : 'Register reviewer'}
      </button>
      {reviewer.reason !== null && <p className="privacy-note">{reviewer.reason}</p>}

      <label className="field">
        <span>Applicant ID</span>
        <input
          autoComplete="off"
          disabled={!applicant.enabled}
          onChange={(event) => setApplicantIdInput(event.target.value)}
          placeholder="64 hexadecimal characters, from the applicant"
          spellCheck={false}
          type="text"
          value={applicantIdInput}
        />
      </label>
      {ownApplicantId !== null && applicant.enabled && (
        <button
          className="text-button"
          onClick={() => setApplicantIdInput(ownApplicantId)}
          type="button"
        >
          Use this browser’s applicant ID
        </button>
      )}
      <p className="privacy-note">
        Enter the attributes you verified. They go into the enrollment commitment and the
        applicant’s receipt, never onto the ledger.
      </p>
      <label className="field">
        <span>Verified income band (0–255)</span>
        <input
          autoComplete="off"
          disabled={!applicant.enabled}
          inputMode="numeric"
          onChange={(event) => setIncomeBandInput(event.target.value)}
          type="text"
          value={incomeBandInput}
        />
      </label>
      <label className="field">
        <span>Verified grade average, x100 (0–65535)</span>
        <input
          autoComplete="off"
          disabled={!applicant.enabled}
          inputMode="numeric"
          onChange={(event) => setGpaScaledInput(event.target.value)}
          type="text"
          value={gpaScaledInput}
        />
      </label>
      <label className="field">
        <span>Verified region code (0–255)</span>
        <input
          autoComplete="off"
          disabled={!applicant.enabled}
          inputMode="numeric"
          onChange={(event) => setRegionCodeInput(event.target.value)}
          type="text"
          value={regionCodeInput}
        />
      </label>
      <button
        aria-busy={round.busy === 'registerApplicant'}
        className="button button-secondary"
        disabled={
          !applicant.enabled ||
          [applicantIdInput, incomeBandInput, gpaScaledInput, regionCodeInput].some(
            (value) => value.trim().length === 0,
          )
        }
        onClick={() =>
          void round.registerApplicant(
            applicantIdInput,
            incomeBandInput,
            gpaScaledInput,
            regionCodeInput,
          )
        }
        type="button"
      >
        {round.busy === 'registerApplicant' ? 'Registering…' : 'Register applicant'}
      </button>
      {applicant.reason !== null && <p className="privacy-note">{applicant.reason}</p>}

      {round.issuedReceipt !== null && (
        <div className="field">
          <span>Enrollment receipt — give this to the applicant privately</span>
          <code className="disclosure-value">{round.issuedReceipt}</code>
          <div className="button-row">
            <CopyButton label="enrollment receipt" value={round.issuedReceipt} />
            <button
              className="button button-secondary"
              disabled={round.busy !== null}
              onClick={() => void round.importReceipt(round.issuedReceipt!)}
              type="button"
            >
              Import into this browser
            </button>
            <button className="text-button" onClick={round.dismissReceipt} type="button">
              Done
            </button>
          </div>
        </div>
      )}

      {next !== undefined ? (
        <button
          aria-busy={round.busy === 'phase'}
          className="button button-primary"
          disabled={!advance.enabled}
          onClick={() => void round.advance(next.to)}
          type="button"
        >
          {round.busy === 'phase' ? 'Advancing…' : next.label}
        </button>
      ) : (
        phase !== null && <p className="privacy-note">The round is in its last phase.</p>
      )}
      {next !== undefined && advance.reason !== null && (
        <p className="privacy-note">{advance.reason}</p>
      )}

      {errorText !== null && (
        <StageMessage
          onDismiss={round.dismissError}
          text={errorText}
          title="This needs attention"
        />
      )}
    </section>
  );
};
