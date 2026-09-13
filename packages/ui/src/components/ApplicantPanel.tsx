import { useState } from 'react';

import type { AequiraRound } from '../hooks/useAequiraRound.js';
import { StageMessage } from './StageMessage.js';

const SETUP_PHASE = 0;
const APPLY_PHASE = 1;

type ApplicantPanelProps = {
  readonly round: AequiraRound;
};

export const ApplicantPanel = ({ round }: ApplicantPanelProps) => {
  const [incomeBandInput, setIncomeBandInput] = useState('');
  const [gpaScaledInput, setGpaScaledInput] = useState('');
  const [regionCodeInput, setRegionCodeInput] = useState('');

  const phase = round.view?.phase;
  const busy = round.busy !== null;
  const canEnroll = phase === SETUP_PHASE;
  const canApply = phase === APPLY_PHASE;

  return (
    <section className="round-card" aria-labelledby="applicant-heading">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Applicant</p>
          <h3 id="applicant-heading">Enroll and apply</h3>
        </div>
      </div>

      <label className="field">
        <span>Income band (0–255)</span>
        <input
          autoComplete="off"
          disabled={busy}
          inputMode="numeric"
          onChange={(event) => setIncomeBandInput(event.target.value)}
          placeholder="2"
          type="text"
          value={incomeBandInput}
        />
      </label>

      <label className="field">
        <span>Scaled grade average (0–65535)</span>
        <input
          autoComplete="off"
          disabled={busy}
          inputMode="numeric"
          onChange={(event) => setGpaScaledInput(event.target.value)}
          placeholder="350"
          type="text"
          value={gpaScaledInput}
        />
      </label>

      <label className="field">
        <span>Region code (0–255)</span>
        <input
          autoComplete="off"
          disabled={busy}
          inputMode="numeric"
          onChange={(event) => setRegionCodeInput(event.target.value)}
          placeholder="7"
          type="text"
          value={regionCodeInput}
        />
      </label>
      <p className="privacy-note">
        Enrollment is computed entirely in this browser. Neither these attributes nor the applicant
        secret behind them ever leave it — only the resulting leaf, below, is meant to be shared.
      </p>

      {round.error !== null && (
        <StageMessage
          onDismiss={round.dismissError}
          text={round.error}
          title="This needs attention"
        />
      )}

      <div className="button-row">
        <button
          aria-busy={round.busy === 'enroll'}
          className="button button-secondary"
          disabled={
            busy ||
            incomeBandInput.trim().length === 0 ||
            gpaScaledInput.trim().length === 0 ||
            regionCodeInput.trim().length === 0
          }
          onClick={() => void round.enroll(incomeBandInput, gpaScaledInput, regionCodeInput)}
          type="button"
        >
          {round.busy === 'enroll' ? 'Computing leaf…' : 'Enroll'}
        </button>
        <button
          aria-busy={round.busy === 'apply'}
          className="button button-primary"
          disabled={busy || !canApply}
          onClick={() => void round.apply()}
          type="button"
        >
          {round.busy === 'apply' ? 'Proving and awaiting Lace…' : 'Submit application'}
        </button>
      </div>

      {round.lastEnrollment !== null && (
        <div className="field">
          <span>Enrollment leaf — hand this to the institution</span>
          <code className="disclosure-value">{round.lastEnrollment.enrollmentLeafHex}</code>
        </div>
      )}

      {!canEnroll && (
        <p className="privacy-note">
          Enrollment leaves computed after setup cannot be registered — the round has moved on.
        </p>
      )}
      {!canApply && (
        <p className="privacy-note">
          Applying is available once the round opens applications, after the institution registers
          this enrollment leaf.
        </p>
      )}
    </section>
  );
};
