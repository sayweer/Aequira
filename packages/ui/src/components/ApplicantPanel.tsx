import { useState } from 'react';

import type { AequiraRound } from '../hooks/useAequiraRound.js';
import { actionAvailability } from '../round-actions.js';
import { CopyButton } from './CopyButton.js';
import { StageMessage } from './StageMessage.js';

type ApplicantPanelProps = {
  readonly round: AequiraRound;
};

export const ApplicantPanel = ({ round }: ApplicantPanelProps) => {
  const [receiptInput, setReceiptInput] = useState('');

  const phase = round.view?.phase ?? null;
  const context = { busy: round.busy !== null, local: round.local, phase };
  const importReceipt = actionAvailability('importReceipt', context);
  const apply = actionAvailability('apply', context);
  const local = round.local;
  const applicantId = round.identity?.applicantIdHex ?? null;
  const errorText = round.errorFor(['importReceipt', 'apply']);

  return (
    <section className="round-card" aria-labelledby="applicant-heading">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Applicant</p>
          <h3 id="applicant-heading">Enroll and apply</h3>
        </div>
      </div>

      {applicantId !== null && (
        <div className="field">
          <span>Your applicant ID — give this to the institution</span>
          <code className="disclosure-value">{applicantId}</code>
          <CopyButton label="applicant ID" value={applicantId} />
        </div>
      )}

      <label className="field">
        <span>Enrollment receipt from the institution</span>
        <textarea
          autoComplete="off"
          disabled={!importReceipt.enabled}
          onChange={(event) => setReceiptInput(event.target.value)}
          placeholder="aequira-enrollment:v1:…"
          rows={3}
          spellCheck={false}
          value={receiptInput}
        />
      </label>
      <p className="privacy-note">
        The receipt holds the attributes the institution verified. It stays in encrypted storage in
        this browser; applying proves they meet the rules without publishing them.
      </p>
      <button
        aria-busy={round.busy === 'importReceipt'}
        className="button button-secondary"
        disabled={!importReceipt.enabled || receiptInput.trim().length === 0}
        onClick={() =>
          void round.importReceipt(receiptInput).then((imported) => {
            // Kept after a failure so it can be corrected, cleared once stored.
            if (imported) {
              setReceiptInput('');
            }
          })
        }
        type="button"
      >
        {round.busy === 'importReceipt' ? 'Checking receipt…' : 'Import receipt'}
      </button>
      {importReceipt.reason !== null && <p className="privacy-note">{importReceipt.reason}</p>}

      {local !== null && (
        <dl className="ledger-grid">
          <div>
            <dt>Receipt</dt>
            <dd>{local.receiptImported ? 'Imported' : 'Not yet'}</dd>
          </div>
          <div>
            <dt>Enrollment</dt>
            <dd>{local.enrolledOnChain ? 'On chain' : 'Not on chain'}</dd>
          </div>
          <div>
            <dt>Application</dt>
            <dd>{local.hasApplied ? 'Submitted' : 'Not yet'}</dd>
          </div>
        </dl>
      )}

      <button
        aria-busy={round.busy === 'apply'}
        className="button button-primary"
        disabled={!apply.enabled}
        onClick={() => void round.apply()}
        type="button"
      >
        {round.busy === 'apply' ? 'Proving and awaiting Lace…' : 'Submit application'}
      </button>
      {apply.reason !== null && <p className="privacy-note">{apply.reason}</p>}

      {local?.applicationIdHex != null && (
        <div className="field">
          <span>Your application ID — reviewers score this pseudonym</span>
          <code className="disclosure-value">{local.applicationIdHex}</code>
          <CopyButton label="application ID" value={local.applicationIdHex} />
        </div>
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
