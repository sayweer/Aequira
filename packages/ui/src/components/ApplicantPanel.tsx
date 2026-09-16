import { useState } from 'react';

import type { AequiraRound } from '../hooks/useAequiraRound.js';
import { actionAvailability } from '../round-actions.js';
import { ActionButton } from './ActionButton.js';
import { HexValue } from './HexValue.js';
import { StageMessage } from './StageMessage.js';

type ApplicantPanelProps = {
  readonly focus: boolean;
  readonly round: AequiraRound;
};

export const ApplicantPanel = ({ focus, round }: ApplicantPanelProps) => {
  const [receiptInput, setReceiptInput] = useState('');

  const phase = round.view?.phase ?? null;
  const context = { busy: round.busy !== null, local: round.local, phase };
  const importReceipt = actionAvailability('importReceipt', context);
  const apply = actionAvailability('apply', context);
  const local = round.local;
  const applicantId = round.identity?.applicantIdHex ?? null;
  const errorText = round.errorFor(['importReceipt', 'apply']);

  const checklist = [
    { done: local?.receiptImported === true, label: 'Receipt imported' },
    { done: local?.enrolledOnChain === true, label: 'Enrollment on chain' },
    { done: local?.hasApplied === true, label: 'Application submitted' },
  ];

  return (
    <section className="panel role-panel" data-focus={focus} aria-labelledby="applicant-heading">
      <header className="panel-header">
        <div>
          <p className="panel-label">Applicant</p>
          <h2 className="panel-title" id="applicant-heading">
            Enroll and apply
          </h2>
        </div>
      </header>

      <ul className="checklist" aria-label="Your progress">
        {checklist.map((item) => (
          <li data-done={item.done} key={item.label}>
            <span className="check-mark" aria-hidden="true" />
            {item.label}
            <span className="visually-hidden">{item.done ? ': done' : ': not yet'}</span>
          </li>
        ))}
      </ul>

      {applicantId !== null && (
        <div className="subsection">
          <h3 className="subsection-title">Your applicant ID</h3>
          <p className="field-hint">
            Give it to the institution. It is a one-way hash: they cannot link it to the application
            you submit later.
          </p>
          <HexValue label="applicant ID" value={applicantId} />
        </div>
      )}

      <div className="subsection">
        <h3 className="subsection-title">Import your enrollment receipt</h3>
        <label className="field">
          <span className="field-label">Receipt from the institution</span>
          <textarea
            autoComplete="off"
            className="mono"
            disabled={!importReceipt.enabled}
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
          availability={importReceipt}
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
      </div>

      <div className="subsection">
        <h3 className="subsection-title">Apply</h3>
        <p className="field-hint">
          A proof shows your figures meet the round’s rules. The figures themselves stay here.
        </p>
        <ActionButton
          availability={apply}
          busy={round.busy === 'apply'}
          busyLabel="Proving and awaiting Lace…"
          onClick={() => void round.apply()}
          variant="primary"
        >
          Submit application
        </ActionButton>
        {local?.applicationIdHex != null && (
          <div className="field">
            <span className="field-label">Your application ID</span>
            <HexValue label="application ID" value={local.applicationIdHex} />
          </div>
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
