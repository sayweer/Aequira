import { useEffect, useState } from 'react';

type CopyButtonProps = {
  readonly label: string;
  readonly value: string;
};

const CONFIRMATION_MS = 1_600;

/** Copies a value and confirms it in place; announces the result to screen readers. */
export const CopyButton = ({ label, value }: CopyButtonProps) => {
  const [state, setState] = useState<'copied' | 'failed' | 'idle'>('idle');

  useEffect(() => {
    if (state === 'idle') {
      return;
    }

    const timeoutId = window.setTimeout(() => setState('idle'), CONFIRMATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  return (
    <button
      aria-label={`Copy ${label}`}
      className="copy-button"
      data-state={state}
      onClick={() => void copy()}
      type="button"
    >
      <span aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
      </span>
    </button>
  );
};
