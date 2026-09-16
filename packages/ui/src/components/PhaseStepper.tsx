import { phaseSteps } from '../round-actions.js';

type PhaseStepperProps = {
  readonly phase: number | null;
};

export const PhaseStepper = ({ phase }: PhaseStepperProps) => (
  <ol className="phase-stepper" aria-label="Round phase">
    {phaseSteps(phase).map((step, index) => (
      <li
        aria-current={step.state === 'current' ? 'step' : undefined}
        className="phase-step"
        data-state={step.state}
        key={step.label}
      >
        <span className="phase-index" aria-hidden="true">
          {index + 1}
        </span>
        <span className="phase-label">{step.label}</span>
      </li>
    ))}
  </ol>
);
