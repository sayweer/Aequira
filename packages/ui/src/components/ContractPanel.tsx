import { useState } from 'react';

import type { AequiraRound } from '../hooks/useAequiraRound.js';
import { describeProofMode } from '../proof-mode.js';
import { StageMessage } from './StageMessage.js';

type ContractPanelProps = {
  readonly round: AequiraRound;
};

export const ContractPanel = ({ round }: ContractPanelProps) => {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [addressInput, setAddressInput] = useState(round.rememberedAddress ?? '');
  const [maxIncomeBand, setMaxIncomeBand] = useState('');
  const [minGpaScaled, setMinGpaScaled] = useState('');

  const opening = round.busy === 'deploy' || round.busy === 'join';
  const isOpen = round.address !== null;

  const errorText = round.errorFor(['deploy', 'join']);

  const submit = async (action: 'deploy' | 'join') => {
    const opened =
      action === 'deploy'
        ? await round.deploy(password, confirmation, maxIncomeBand, minGpaScaled)
        : await round.join(password, confirmation, addressInput);

    // Kept on failure, so a retry does not mean typing both passwords again.
    if (opened) {
      setPassword('');
      setConfirmation('');
    }
  };

  return (
    <section className="deployment-card" aria-labelledby="deployment-heading">
      <div className="deployment-heading">
        <div>
          <p className="panel-kicker">Contract workspace</p>
          <h3 id="deployment-heading">{isOpen ? 'Round open' : 'Deploy or join a round'}</h3>
        </div>
        <span
          className={`deployment-status deployment-status-${isOpen ? 'deployed' : opening ? 'deploying' : 'idle'}`}
          aria-live="polite"
        >
          {isOpen ? 'Preprod' : opening ? 'In progress' : 'Not open'}
        </span>
      </div>

      {isOpen ? (
        <div className="deployment-success">
          <span>Verifiable contract address</span>
          <strong>{round.address}</strong>
          <p>
            The address is public. Administrator and reviewer secrets remain encrypted in this
            browser.
          </p>
          {round.proofMode !== null && (
            <p className="proof-mode-chip">{describeProofMode(round.proofMode)}</p>
          )}
        </div>
      ) : (
        <>
          <p className="deployment-copy">
            Choose a local-only password. It encrypts AEQUIRA private state in this browser and is
            never sent to Lace or the network.
          </p>

          <div className="password-grid">
            <label>
              <span>Local storage password</span>
              <input
                autoComplete="new-password"
                disabled={opening}
                minLength={16}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
            </label>
            <label>
              <span>Confirm password</span>
              <input
                autoComplete="new-password"
                disabled={opening}
                minLength={16}
                onChange={(event) => setConfirmation(event.target.value)}
                type="password"
                value={confirmation}
              />
            </label>
          </div>

          <p className="deployment-copy">
            The eligibility rules are published with the round and cannot change once it is open.
            Applicants prove they clear them without revealing the figures behind the proof.
          </p>

          <div className="password-grid">
            <label>
              <span>Maximum income band (0-255)</span>
              <input
                autoComplete="off"
                disabled={opening}
                inputMode="numeric"
                onChange={(event) => setMaxIncomeBand(event.target.value)}
                type="text"
                value={maxIncomeBand}
              />
            </label>
            <label>
              <span>Minimum grade average, x100 (320 = 3.20)</span>
              <input
                autoComplete="off"
                disabled={opening}
                inputMode="numeric"
                onChange={(event) => setMinGpaScaled(event.target.value)}
                type="text"
                value={minGpaScaled}
              />
            </label>
          </div>

          {errorText !== null && (
            <StageMessage
              onDismiss={round.dismissError}
              text={errorText}
              title="This needs attention"
            />
          )}

          <button
            aria-busy={round.busy === 'deploy'}
            className="button button-primary button-full deployment-button"
            disabled={opening}
            onClick={() => void submit('deploy')}
            type="button"
          >
            {round.busy === 'deploy' ? 'Proving and awaiting Lace…' : 'Deploy a new round'}
          </button>

          <div className="join-row">
            <label>
              <span>Or join an existing round</span>
              <input
                autoComplete="off"
                disabled={opening}
                onChange={(event) => setAddressInput(event.target.value)}
                placeholder="Contract address"
                spellCheck={false}
                type="text"
                value={addressInput}
              />
            </label>
            <button
              aria-busy={round.busy === 'join'}
              className="button button-secondary button-full"
              disabled={opening || addressInput.trim().length === 0}
              onClick={() => void submit('join')}
              type="button"
            >
              {round.busy === 'join' ? 'Opening…' : 'Join round'}
            </button>
            {round.rememberedAddress !== null && (
              <p className="privacy-note">
                This browser last used a round at that address. Joining reuses the secrets it
                already holds.
              </p>
            )}
          </div>

          <p className="privacy-note deployment-note">
            Lace will show the tDUST-funded transaction before it is submitted.
          </p>
        </>
      )}
    </section>
  );
};
