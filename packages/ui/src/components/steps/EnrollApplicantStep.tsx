import { useState } from 'react';

import type { AequiraRound } from '../../hooks/useAequiraRound.js';
import { actionAvailability } from '../../round-actions.js';
import { ActionButton } from '../ActionButton.js';
import { CopyButton } from '../CopyButton.js';
import { HexValue } from '../HexValue.js';

type EnrollApplicantStepProps = {
  readonly round: AequiraRound;
};

export const EnrollApplicantStep = ({ round }: EnrollApplicantStepProps) => {
  const [applicantIdInput, setApplicantIdInput] = useState('');
  const [incomeBandInput, setIncomeBandInput] = useState('');
  const [gpaScaledInput, setGpaScaledInput] = useState('');
  const [regionCodeInput, setRegionCodeInput] = useState('');

  const ownApplicantId = round.identity?.applicantIdHex ?? null;
  const availability = actionAvailability('registerApplicant', {
    busy: round.busy !== null,
    local: round.local,
    phase: round.view?.phase ?? null,
  });
  const attributesMissing = [
    applicantIdInput,
    incomeBandInput,
    gpaScaledInput,
    regionCodeInput,
  ].some((value) => value.trim().length === 0);

  return (
    <>
      <p className="field-hint">
        Enter the figures you verified. They go into the enrollment commitment and the applicant’s
        receipt, never onto the ledger.
      </p>

      {ownApplicantId !== null && (
        <div className="field">
          <span className="field-label">This browser’s applicant ID</span>
          <HexValue label="applicant ID" value={ownApplicantId} />
          <span className="field-hint">
            A real round receives this from the applicant. It is a one-way hash, so it cannot be
            linked to the application they submit later.
          </span>
        </div>
      )}

      <label className="field">
        <span className="field-label">Applicant ID</span>
        <input
          autoComplete="off"
          className="mono"
          disabled={!availability.enabled}
          onChange={(event) => setApplicantIdInput(event.target.value)}
          placeholder="64 hex characters, from the applicant"
          spellCheck={false}
          type="text"
          value={applicantIdInput}
        />
      </label>
      {ownApplicantId !== null && availability.enabled && applicantIdInput !== ownApplicantId && (
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
            disabled={!availability.enabled}
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
            disabled={!availability.enabled}
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
            disabled={!availability.enabled}
            inputMode="numeric"
            onChange={(event) => setRegionCodeInput(event.target.value)}
            placeholder="0–255"
            type="text"
            value={regionCodeInput}
          />
        </label>
      </div>

      <ActionButton
        availability={availability}
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
        variant="primary"
      >
        Enroll applicant
      </ActionButton>

      {round.issuedReceipt !== null && (
        <div className="receipt" role="region" aria-label="Enrollment receipt">
          <p className="receipt-title">Enrollment receipt</p>
          <p className="field-hint">
            Give this to the applicant privately. It holds the verified figures and the salt, and it
            is not kept anywhere once you close it.
          </p>
          <code className="receipt-value">{round.issuedReceipt}</code>
          <div className="button-row">
            <CopyButton label="enrollment receipt" value={round.issuedReceipt} />
            <button className="text-button" onClick={round.dismissReceipt} type="button">
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
};
