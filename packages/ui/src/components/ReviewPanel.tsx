import { useState } from 'react';

import type { AequiraRound } from '../hooks/useAequiraRound.js';
import { StageMessage } from './StageMessage.js';

const REVIEW_PHASE = 2;
const REVEAL_PHASE = 3;

type ReviewPanelProps = {
  readonly round: AequiraRound;
};

export const ReviewPanel = ({ round }: ReviewPanelProps) => {
  const [applicationIdInput, setApplicationIdInput] = useState('');
  const [scoreInput, setScoreInput] = useState('');

  const phase = round.view?.phase;
  const busy = round.busy !== null;
  const canCommit = phase === REVIEW_PHASE;
  const canReveal = phase === REVEAL_PHASE;

  return (
    <section className="round-card" aria-labelledby="review-heading">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Reviewer</p>
          <h3 id="review-heading">{canReveal ? 'Open a sealed score' : 'Seal a score'}</h3>
        </div>
      </div>

      <label className="field">
        <span>Application ID</span>
        <input
          autoComplete="off"
          disabled={busy}
          onChange={(event) => setApplicationIdInput(event.target.value)}
          placeholder="64 hexadecimal characters"
          spellCheck={false}
          type="text"
          value={applicationIdInput}
        />
      </label>

      <label className="field">
        <span>Score (0–100)</span>
        <input
          autoComplete="off"
          disabled={busy}
          inputMode="numeric"
          onChange={(event) => setScoreInput(event.target.value)}
          placeholder="93"
          type="text"
          value={scoreInput}
        />
      </label>
      <p className="privacy-note">
        The score is written to encrypted browser storage and read by the circuit as a witness. Only
        its salted commitment reaches the transaction.
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
          aria-busy={round.busy === 'commit'}
          className="button button-primary"
          disabled={busy || !canCommit}
          onClick={() => void round.commit(applicationIdInput, scoreInput)}
          type="button"
        >
          {round.busy === 'commit' ? 'Proving and awaiting Lace…' : 'Commit sealed score'}
        </button>
        <button
          aria-busy={round.busy === 'reveal'}
          className="button button-secondary"
          disabled={busy || !canReveal}
          onClick={() => void round.reveal(applicationIdInput, scoreInput)}
          type="button"
        >
          {round.busy === 'reveal' ? 'Opening…' : 'Reveal score'}
        </button>
      </div>

      {!canCommit && !canReveal && (
        <p className="privacy-note">
          Scoring is available during review, and opening during reveal. The organizer controls the
          phase.
        </p>
      )}
      {canReveal && (
        <p className="privacy-note">
          Enter the same score you committed. AEQUIRA checks the opening against the on-chain
          commitment in this browser before spending a proof on it.
        </p>
      )}
    </section>
  );
};
