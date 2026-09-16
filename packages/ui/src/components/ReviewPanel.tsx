import { useEffect, useMemo, useState } from 'react';

import type { AequiraRound } from '../hooks/useAequiraRound.js';
import { actionAvailability, PHASE } from '../round-actions.js';
import { shortenHex } from '../round-format.js';
import { ActionButton } from './ActionButton.js';
import { StageMessage } from './StageMessage.js';

type ReviewPanelProps = {
  readonly focus: boolean;
  readonly round: AequiraRound;
};

export const ReviewPanel = ({ focus, round }: ReviewPanelProps) => {
  const [applicationId, setApplicationId] = useState('');
  const [scoreInput, setScoreInput] = useState('');

  const phase = round.view?.phase ?? null;
  const context = { busy: round.busy !== null, local: round.local, phase };
  const isReveal = phase === PHASE.REVEAL;
  const availability = actionAvailability(isReveal ? 'reveal' : 'commit', context);
  const tallies = round.view?.tallies;
  const applications = useMemo(
    () => tallies?.map((tally) => tally.applicationIdHex) ?? [],
    [tallies],
  );
  const errorText = round.errorFor(['commit', 'reveal']);

  // Starts on the first submitted application, and follows the list if the
  // chosen one is not in it (a different round, or before the ledger loads).
  useEffect(() => {
    if (applications.length > 0 && !applications.includes(applicationId)) {
      setApplicationId(applications[0]!);
    }
  }, [applicationId, applications]);

  return (
    <section className="panel role-panel" data-focus={focus} aria-labelledby="review-heading">
      <header className="panel-header">
        <div>
          <p className="panel-label">Reviewer</p>
          <h2 className="panel-title" id="review-heading">
            {isReveal ? 'Open your sealed score' : 'Seal a score'}
          </h2>
        </div>
        {round.local !== null && (
          <span
            className="chip"
            data-tone={round.local.isRegisteredReviewer ? 'success' : 'neutral'}
          >
            {round.local.isRegisteredReviewer ? 'On the roster' : 'Not on the roster'}
          </span>
        )}
      </header>

      {applications.length === 0 ? (
        <p className="panel-text">No applications have been submitted yet.</p>
      ) : (
        <div className="field-row">
          <label className="field">
            <span className="field-label">Application</span>
            <select
              className="mono"
              disabled={round.busy !== null}
              onChange={(event) => setApplicationId(event.target.value)}
              value={applicationId}
            >
              {applications.map((id) => (
                <option key={id} value={id}>
                  {shortenHex(id)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Score, 0–100</span>
            <input
              autoComplete="off"
              disabled={round.busy !== null}
              inputMode="numeric"
              onChange={(event) => setScoreInput(event.target.value)}
              type="password"
              value={scoreInput}
            />
          </label>
        </div>
      )}

      <p className="field-hint">
        {isReveal
          ? 'Enter the score you committed. This browser checks it against the on-chain commitment before spending a proof.'
          : 'The score is masked, kept in encrypted browser storage and read by the circuit as a witness. Only its salted commitment is published.'}
      </p>

      <ActionButton
        availability={availability}
        busy={round.busy === (isReveal ? 'reveal' : 'commit')}
        busyLabel={isReveal ? 'Opening…' : 'Proving and awaiting Lace…'}
        disabled={applicationId.length === 0 || scoreInput.trim().length === 0}
        onClick={() =>
          void (isReveal ? round.reveal : round.commit)(applicationId, scoreInput).then((done) => {
            if (done) {
              setScoreInput('');
            }
          })
        }
        variant="primary"
      >
        {isReveal ? 'Reveal score' : 'Commit sealed score'}
      </ActionButton>

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
