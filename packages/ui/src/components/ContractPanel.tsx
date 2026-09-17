import { useState } from 'react';

import type { AequiraRound } from '../hooks/useAequiraRound.js';
import { ActionButton } from './ActionButton.js';
import { StageMessage } from './StageMessage.js';

type ContractPanelProps = {
  /** Rendered inside the wizard, which supplies the heading and the frame. */
  readonly chromeless?: boolean;
  readonly enabled: boolean;
  readonly round: AequiraRound;
};

export const ContractPanel = ({ chromeless = false, enabled, round }: ContractPanelProps) => {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [addressInput, setAddressInput] = useState(round.rememberedAddress ?? '');
  const [maxIncomeBand, setMaxIncomeBand] = useState('');
  const [minGpaScaled, setMinGpaScaled] = useState('');

  const opening = round.busy === 'deploy' || round.busy === 'join';
  const locked = !enabled || opening;
  const errorText = round.errorFor(['deploy', 'join']);
  const waitingForWallet = enabled ? undefined : { enabled: false, reason: 'Connect Lace first.' };

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

  const body = (
    <>
      <fieldset className="field-group" disabled={locked}>
        <legend className="field-label">Local storage password</legend>
        <p className="field-hint">
          Encrypts this round’s secrets in this browser. It is never sent to Lace or the network,
          and it cannot be recovered.
        </p>
        <div className="field-row">
          <label className="field">
            <span className="field-label">Password</span>
            <input
              autoComplete="new-password"
              minLength={16}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>
          <label className="field">
            <span className="field-label">Confirm</span>
            <input
              autoComplete="new-password"
              minLength={16}
              onChange={(event) => setConfirmation(event.target.value)}
              type="password"
              value={confirmation}
            />
          </label>
        </div>
      </fieldset>

      <div className="open-options">
        <fieldset className="field-group" disabled={locked}>
          <legend className="field-label">Deploy a new round</legend>
          <p className="field-hint">
            The eligibility rules are published with the round and cannot change once it is open.
          </p>
          <div className="field-row">
            <label className="field">
              <span className="field-label">Max income band</span>
              <input
                autoComplete="off"
                inputMode="numeric"
                onChange={(event) => setMaxIncomeBand(event.target.value)}
                placeholder="0–255"
                type="text"
                value={maxIncomeBand}
              />
            </label>
            <label className="field">
              <span className="field-label">Min grade average ×100</span>
              <input
                autoComplete="off"
                inputMode="numeric"
                onChange={(event) => setMinGpaScaled(event.target.value)}
                placeholder="300 = 3.00"
                type="text"
                value={minGpaScaled}
              />
            </label>
          </div>
          <ActionButton
            availability={waitingForWallet}
            busy={round.busy === 'deploy'}
            busyLabel="Proving and awaiting Lace…"
            disabled={opening}
            onClick={() => void submit('deploy')}
            variant="primary"
          >
            Deploy a new round
          </ActionButton>
        </fieldset>

        <fieldset className="field-group" disabled={locked}>
          <legend className="field-label">Or join an existing round</legend>
          <p className="field-hint">
            {round.rememberedAddress === null
              ? 'Paste the contract address the organizer shared.'
              : 'This browser last used the round below; joining reuses the secrets it holds.'}
          </p>
          <label className="field">
            <span className="field-label">Contract address</span>
            <input
              autoComplete="off"
              className="mono"
              onChange={(event) => setAddressInput(event.target.value)}
              spellCheck={false}
              type="text"
              value={addressInput}
            />
          </label>
          <ActionButton
            busy={round.busy === 'join'}
            busyLabel="Opening…"
            disabled={opening || !enabled || addressInput.trim().length === 0}
            onClick={() => void submit('join')}
          >
            Join round
          </ActionButton>
        </fieldset>
      </div>

      {/* The wizard renders this step's errors itself, so it is not repeated there. */}
      {!chromeless && errorText !== null && (
        <StageMessage
          onDismiss={round.dismissError}
          text={errorText}
          title="The round did not open"
        />
      )}
    </>
  );

  if (chromeless) {
    return body;
  }

  return (
    <section className="panel" aria-labelledby="contract-heading">
      <header className="panel-header">
        <div>
          <p className="panel-label">Step 2</p>
          <h2 className="panel-title" id="contract-heading">
            Open a round
          </h2>
        </div>
      </header>
      {body}
    </section>
  );
};
