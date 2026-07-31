type StageMessageProps = {
  readonly onDismiss?: (() => void) | undefined;
  readonly text: string;
  readonly title: string;
};

export const StageMessage = ({ onDismiss, text, title }: StageMessageProps) => (
  <div className="error-message" role="alert">
    <strong>{title}</strong>
    <p>{text}</p>
    {onDismiss !== undefined && (
      <button className="text-button" type="button" onClick={onDismiss}>
        Dismiss
      </button>
    )}
  </div>
);
