import { useEffect, useMemo, useState } from 'react';

import type { AequiraRound } from '../hooks/useAequiraRound.js';
import { actionAvailability, PHASE } from '../round-actions.js';
import { shortenHex } from '../round-format.js';
import { StageMessage } from './StageMessage.js';

type ReviewPanelProps = {
  readonly round: AequiraRound;
};

export const ReviewPanel = ({ round }: ReviewPanelProps) => {
  const [applicationId, setApplicationId] = useState('');
  const [scoreInput, setScoreInput] = useState('');

  const phase = round.view?.phase ?? null;
  const context = { busy: round.busy !== null, local: round.local, phase };
  const commit = actionAvailability('commit', context);
  const reveal = actionAvailability('reveal', context);
  const tallies = round.view?.tallies;
  const applications = useMemo(
    () => tallies?.map((tally) => tally.applicationIdHex) ?? [],
    [tallies],
  );
  const isReveal = phase === PHASE.REVEAL;
  const errorText = round.errorFor(['commit', 'reveal']);

  // Starts on the first submitted application, and follows the list if the
  // chosen one is not in it (a different round, or before the ledger loads).
  useEffect(() => {
    if (applications.length > 0 && !applications.includes(applicationId)) {
      setApplicationId(applications[0]!);
    }
  }, [applicationId, applications]);

  return (
    <section className="round-card" aria-labelledby="review-heading">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Reviewer</p>
          <h3 id="review-heading">{isReveal ? 'Open a sealed score' : 'Seal a score'}</h3>
        </div>
      </div>

      {applications.length === 0 ? (
        <p className="privacy-note">No applications have been submitted yet.</p>
      ) : (
        <label className="field">
          <span>Application</span>
          <select
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
      )}

      <label className="field">
        <span>Score (0–100)</span>
        <input
          autoComplete="off"
          disabled={round.busy !== null}
          inputMode="numeric"
          onChange={(event) => setScoreInput(event.target.value)}
          type="password"
          value={scoreInput}
        />
      </label>
      <p className="privacy-note">
        {isReveal
          ? 'Enter the score you committed. This browser checks it against the on-chain commitment before spending a proof.'
          : 'The score is written to encrypted browser storage and read by the circuit as a witness. Only its salted commitment reaches the transaction.'}
      </p>

      {isReveal ? (
        <button
          aria-busy={round.busy === 'reveal'}
          className="button button-primary"
          disabled={!reveal.enabled || applicationId.length === 0}
          onClick={() => void round.reveal(applicationId, scoreInput)}
          type="button"
        >
          {round.busy === 'reveal' ? 'Opening…' : 'Reveal score'}
        </button>
      ) : (
        <button
          aria-busy={round.busy === 'commit'}
          className="button button-primary"
          disabled={!commit.enabled || applicationId.length === 0}
          onClick={() => void round.commit(applicationId, scoreInput)}
          type="button"
        >
          {round.busy === 'commit' ? 'Proving and awaiting Lace…' : 'Commit sealed score'}
        </button>
      )}
      {(isReveal ? reveal : commit).reason !== null && (
        <p className="privacy-note">{(isReveal ? reveal : commit).reason}</p>
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
