import { useEffect, useState } from 'react';

import type { AequiraRound } from '../hooks/useAequiraRound.js';
import { actionAvailability, PHASE } from '../round-actions.js';
import type { PhaseTransition } from '../round.js';
import { ActionButton } from './ActionButton.js';
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
  readonly focus: boolean;
  readonly round: AequiraRound;
};

export const AdminPanel = ({ focus, round }: AdminPanelProps) => {
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
  const attributesMissing = [
    applicantIdInput,
    incomeBandInput,
    gpaScaledInput,
    regionCodeInput,
  ].some((value) => value.trim().length === 0);

  return (
    <section className="panel role-panel" data-focus={focus} aria-labelledby="admin-heading">
      <header className="panel-header">
        <div>
          <p className="panel-label">Organizer</p>
          <h2 className="panel-title" id="admin-heading">
            Set up the round
          </h2>
        </div>
        {round.local?.isAdmin === false && (
          <span className="chip" data-tone="neutral">
            View only
          </span>
        )}
      </header>

      <div className="subsection">
        <h3 className="subsection-title">Register a reviewer</h3>
        <label className="field">
          <span className="field-label">Reviewer pseudonym</span>
          <input
            autoComplete="off"
            className="mono"
            disabled={!reviewer.enabled}
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
          availability={reviewer}
          busy={round.busy === 'register'}
          busyLabel="Registering…"
          disabled={reviewerIdInput.trim().length === 0}
          onClick={() => void round.registerReviewer(reviewerIdInput)}
        >
          Register reviewer
        </ActionButton>
      </div>

      <div className="subsection">
        <h3 className="subsection-title">Enroll an applicant</h3>
        <p className="field-hint">
          Enter the figures you verified. They go into the enrollment commitment and the applicant’s
          receipt, never onto the ledger.
        </p>
        <label className="field">
          <span className="field-label">Applicant ID</span>
          <input
            autoComplete="off"
            className="mono"
            disabled={!applicant.enabled}
            onChange={(event) => setApplicantIdInput(event.target.value)}
            placeholder="64 hex characters, from the applicant"
            spellCheck={false}
            type="text"
            value={applicantIdInput}
          />
        </label>
        {ownApplicantId !== null && applicant.enabled && applicantIdInput !== ownApplicantId && (
          <button
            className="text-button"
            onClick={() => setApplicantIdInput(ownApplicantId)}
            type="button"
          >
            Use this browser’s applicant ID
          </button>
        )}
        <div className="field-row is-three">
          <label className="field">
            <span className="field-label">Income band</span>
            <input
              autoComplete="off"
              disabled={!applicant.enabled}
              inputMode="numeric"
              onChange={(event) => setIncomeBandInput(event.target.value)}
              placeholder="0–255"
              type="text"
              value={incomeBandInput}
            />
          </label>
          <label className="field">
            <span className="field-label">Grade ×100</span>
            <input
              autoComplete="off"
              disabled={!applicant.enabled}
              inputMode="numeric"
              onChange={(event) => setGpaScaledInput(event.target.value)}
              placeholder="0–65535"
              type="text"
              value={gpaScaledInput}
            />
          </label>
          <label className="field">
            <span className="field-label">Region</span>
            <input
              autoComplete="off"
              disabled={!applicant.enabled}
              inputMode="numeric"
              onChange={(event) => setRegionCodeInput(event.target.value)}
              placeholder="0–255"
              type="text"
              value={regionCodeInput}
            />
          </label>
        </div>
        <ActionButton
          availability={applicant}
          busy={round.busy === 'registerApplicant'}
          busyLabel="Registering…"
          disabled={attributesMissing}
          onClick={() =>
            void round.registerApplicant(
              applicantIdInput,
              incomeBandInput,
              gpaScaledInput,
              regionCodeInput,
            )
          }
        >
          Enroll applicant
        </ActionButton>

        {round.issuedReceipt !== null && (
          <div className="receipt" role="region" aria-label="Enrollment receipt">
            <p className="receipt-title">Enrollment receipt</p>
            <p className="field-hint">
              Give this to the applicant privately. It holds the verified figures and the salt, and
              it is not kept anywhere once you close it.
            </p>
            <code className="receipt-value">{round.issuedReceipt}</code>
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
                Close
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="subsection">
        <h3 className="subsection-title">Advance the round</h3>
        {next === undefined ? (
          <p className="field-hint">
            {phase === null ? 'Waiting for the public ledger.' : 'The round is in its last phase.'}
          </p>
        ) : (
          <ActionButton
            availability={advance}
            busy={round.busy === 'phase'}
            busyLabel="Advancing…"
            onClick={() => void round.advance(next.to)}
            variant="primary"
          >
            {next.label}
          </ActionButton>
        )}
      </div>

      {errorText !== null && (
        <StageMessage
          onDismiss={round.dismissError}
          text={errorText}
          title="That did not go through"
        />
      )}
    </section>
  );
};
