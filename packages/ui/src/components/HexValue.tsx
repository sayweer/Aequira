import { shortenHex } from '../round-format.js';
import { CopyButton } from './CopyButton.js';

type HexValueProps = {
  /** What the value is, for the copy button's accessible name. */
  readonly label: string;
  readonly value: string;
  /** Shows the whole value, wrapped, instead of its two ends. */
  readonly full?: boolean;
};

export const HexValue = ({ full = false, label, value }: HexValueProps) => (
  <div className={full ? 'hex-value is-full' : 'hex-value'}>
    <code title={value}>{full ? value : shortenHex(value)}</code>
    <CopyButton label={label} value={value} />
  </div>
);
