import type { AequiraRound } from '../../hooks/useAequiraRound.js';
import { actionAvailability } from '../../round-actions.js';
import { ActionButton } from '../ActionButton.js';
import { HexValue } from '../HexValue.js';

type ApplyStepProps = {
  readonly round: AequiraRound;
};

export const ApplyStep = ({ round }: ApplyStepProps) => {
  const availability = actionAvailability('apply', {
    busy: round.busy !== null,
    local: round.local,
    phase: round.view?.phase ?? null,
  });
  const applicationIdHex = round.local?.applicationIdHex ?? null;

  return (
    <>
      <p className="field-hint">
        A proof shows your figures meet the round’s rules. The figures themselves stay here.
      </p>
      <ActionButton
        availability={availability}
        busy={round.busy === 'apply'}
        busyLabel="Proving and awaiting Lace…"
        onClick={() => void round.apply()}
        variant="primary"
      >
        Submit application
      </ActionButton>
      {applicationIdHex !== null && (
        <div className="field">
          <span className="field-label">Your application ID</span>
          <HexValue label="application ID" value={applicationIdHex} />
          <span className="field-hint">
            Public, and the only thing the ledger learns. Nothing on chain links it back to you.
          </span>
        </div>
      )}
    </>
  );
};
