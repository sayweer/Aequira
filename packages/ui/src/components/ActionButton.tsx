import { useId, type ReactNode } from 'react';

import type { Availability } from '../round-actions.js';

type ActionButtonProps = {
  /** The round's verdict on this action; its reason is shown and announced. */
  readonly availability?: Availability | undefined;
  readonly busy?: boolean;
  readonly busyLabel?: string;
  readonly children: ReactNode;
  /** A local condition on top of availability, such as an empty field. */
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly variant?: 'ghost' | 'primary' | 'secondary';
};

export const ActionButton = ({
  availability,
  busy = false,
  busyLabel,
  children,
  disabled = false,
  onClick,
  variant = 'secondary',
}: ActionButtonProps) => {
  const reasonId = useId();
  const reason = busy ? null : (availability?.reason ?? null);

  return (
    <div className="action">
      <button
        aria-busy={busy}
        aria-describedby={reason === null ? undefined : reasonId}
        className={`button button-${variant}`}
        disabled={busy || disabled || availability?.enabled === false}
        onClick={onClick}
        type="button"
      >
        {busy && <span className="spinner" aria-hidden="true" />}
        <span>{busy && busyLabel !== undefined ? busyLabel : children}</span>
      </button>
      {reason !== null && (
        <p className="action-reason" id={reasonId}>
          {reason}
        </p>
      )}
    </div>
  );
};
