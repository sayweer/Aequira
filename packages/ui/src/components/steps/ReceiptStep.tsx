import { useState } from 'react';

import type { AequiraRound } from '../../hooks/useAequiraRound.js';
import { actionAvailability } from '../../round-actions.js';
import { ActionButton } from '../ActionButton.js';
import { CopyButton } from '../CopyButton.js';

type ReceiptStepProps = {
  readonly round: AequiraRound;
};

export const ReceiptStep = ({ round }: ReceiptStepProps) => {
  const [receiptInput, setReceiptInput] = useState('');

  const availability = actionAvailability('importReceipt', {
    busy: round.busy !== null,
    local: round.local,
    phase: round.view?.phase ?? null,
  });
  const issued = round.issuedReceipt;

  return (
    <>
      {issued !== null && (
        <div className="receipt" role="region" aria-label="Enrollment receipt">
          <p className="receipt-title">The receipt this browser just issued</p>
          <p className="field-hint">
            One browser is playing both roles here, so it can be handed over directly. Two people
            would pass it out of band and paste it below.
          </p>
          <div className="button-row">
            <CopyButton label="enrollment receipt" value={issued} />
            <button
              className="button button-primary"
              disabled={round.busy !== null}
              onClick={() => void round.importReceipt(issued)}
              type="button"
            >
              Import into this browser
            </button>
          </div>
        </div>
      )}

      <label className="field">
        <span className="field-label">Receipt from the institution</span>
        <textarea
          autoComplete="off"
          className="mono"
          disabled={!availability.enabled}
          onChange={(event) => setReceiptInput(event.target.value)}
          placeholder="aequira-enrollment:v1:…"
          rows={3}
          spellCheck={false}
          value={receiptInput}
        />
        <span className="field-hint">
          Checked against your own secret, then kept only in this browser’s encrypted storage.
        </span>
      </label>
      <ActionButton
        availability={availability}
        busy={round.busy === 'importReceipt'}
        busyLabel="Checking receipt…"
        disabled={receiptInput.trim().length === 0}
        onClick={() =>
          void round.importReceipt(receiptInput).then((imported) => {
            // Kept after a failure so it can be corrected, cleared once stored.
            if (imported) {
              setReceiptInput('');
            }
          })
        }
      >
        Import receipt
      </ActionButton>
    </>
  );
};
