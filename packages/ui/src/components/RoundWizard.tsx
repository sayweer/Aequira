import type { WalletConnection } from '../hooks/useWalletConnection.js';
import type { AequiraRound } from '../hooks/useAequiraRound.js';
import {
  currentRoundStep,
  ROUND_STEP_COUNT,
  roundStepPosition,
  roundSteps,
  unreachableRoundStep,
  type RoundStepId,
} from '../round-steps.js';
import { ContractPanel } from './ContractPanel.js';
import { StageMessage } from './StageMessage.js';
import { WalletPanel } from './WalletPanel.js';
import { AdvanceStep } from './steps/AdvanceStep.js';
import { ApplyStep } from './steps/ApplyStep.js';
import { EnrollApplicantStep } from './steps/EnrollApplicantStep.js';
import { ReceiptStep } from './steps/ReceiptStep.js';
import { RegisterReviewerStep } from './steps/RegisterReviewerStep.js';
import { ScoreStep } from './steps/ScoreStep.js';

/** Who acts on each step, so the screen says whose turn it is. */
const ROLE: Record<RoundStepId, string> = {
  apply: 'Applicant',
  commit: 'Reviewer',
  enrollment: 'Organizer',
  openApplications: 'Organizer',
  openReveal: 'Organizer',
  openReview: 'Organizer',
  receipt: 'Applicant',
  register: 'Organizer',
  reveal: 'Reviewer',
  round: 'Organizer',
  wallet: 'You',
};

/** Which action errors belong to each step, so one step never shows another's. */
const ERROR_ACTIONS = {
  apply: ['apply'],
  commit: ['commit'],
  enrollment: ['registerApplicant'],
  openApplications: ['phase'],
  openReveal: ['phase'],
  openReview: ['phase'],
  receipt: ['importReceipt'],
  register: ['register'],
  reveal: ['reveal'],
  round: ['deploy', 'join'],
  wallet: [],
} as const;

type RoundWizardProps = {
  readonly round: AequiraRound;
  readonly wallet: WalletConnection;
};

export const RoundWizard = ({ round, wallet }: RoundWizardProps) => {
  const progress = {
    address: round.address,
    commitmentHexes: round.view?.commitmentHexes ?? [],
    connected: wallet.isConnected,
    lastScore: round.lastScore,
    local: round.local,
    phase: round.view?.phase ?? null,
  };
  const steps = roundSteps(progress);
  const step = currentRoundStep(progress);
  const stranded = unreachableRoundStep(progress);

  // Phases only move forward, so a step missed before its deadline cannot be
  // taken now and the round can never be finished. Rounds opened by an older
  // build reach this, and saying so beats offering a form that cannot work.
  if (stranded !== null) {
    return (
      <section className="panel wizard" aria-labelledby="wizard-heading">
        <header className="panel-header">
          <div>
            <p className="panel-label">This round cannot be finished</p>
            <h2 className="panel-title" id="wizard-heading">
              {stranded.title} was missed before it closed
            </h2>
          </div>
          <span className="chip" data-tone="danger">
            {round.view?.phaseLabel ?? 'Unknown phase'}
          </span>
        </header>
        <p className="panel-text">
          {stranded.summary} The round has moved past the phase that allowed it, and phases only
          move forward, so the remaining steps can never be completed. Open a new round to walk it
          through from the start.
        </p>
        <div className="button-row">
          <button className="button button-primary" onClick={round.clear} type="button">
            Leave this round
          </button>
        </div>
      </section>
    );
  }

  if (step === null) {
    return (
      <section className="panel wizard" aria-labelledby="wizard-heading">
        <header className="panel-header">
          <div>
            <p className="panel-label">Round complete</p>
            <h2 className="panel-title" id="wizard-heading">
              The tally is public and the score is open
            </h2>
          </div>
          <span className="chip" data-tone="success">
            {ROUND_STEP_COUNT} of {ROUND_STEP_COUNT}
          </span>
        </header>
        <p className="panel-text">
          Every step of the round is done. The ledger below holds the outcome, and the panel under
          it shows what was never published to get there.
        </p>
      </section>
    );
  }

  const position = roundStepPosition(step.id);
  const errorText = round.errorFor([...ERROR_ACTIONS[step.id]]);

  const body =
    step.id === 'wallet' ? (
      <WalletPanel busy={round.busy !== null} chromeless wallet={wallet} />
    ) : step.id === 'round' ? (
      <ContractPanel chromeless enabled={wallet.isConnected} round={round} />
    ) : step.id === 'register' ? (
      <RegisterReviewerStep round={round} />
    ) : step.id === 'enrollment' ? (
      <EnrollApplicantStep round={round} />
    ) : step.id === 'receipt' ? (
      <ReceiptStep round={round} />
    ) : step.id === 'apply' ? (
      <ApplyStep round={round} />
    ) : step.id === 'commit' ? (
      <ScoreStep mode="commit" round={round} />
    ) : step.id === 'reveal' ? (
      <ScoreStep mode="reveal" round={round} />
    ) : (
      <AdvanceStep round={round} />
    );

  return (
    <section className="panel wizard" aria-labelledby="wizard-heading">
      <header className="panel-header">
        <div>
          <p className="panel-label">
            Step {position} of {ROUND_STEP_COUNT} · {ROLE[step.id]}
          </p>
          <h2 className="panel-title" id="wizard-heading">
            {step.title}
          </h2>
        </div>
      </header>

      <ol className="wizard-rail" aria-label="Round progress">
        {steps.map((entry) => (
          <li
            aria-current={entry.id === step.id ? 'step' : undefined}
            data-state={entry.done ? 'done' : entry.id === step.id ? 'current' : 'upcoming'}
            key={entry.id}
          >
            <span className="visually-hidden">
              {entry.title}
              {entry.done ? ': done' : entry.id === step.id ? ': current' : ': not yet'}
            </span>
          </li>
        ))}
      </ol>

      <p className="panel-text">{step.summary}</p>

      <div className="wizard-body">{body}</div>

      {errorText !== null && (
        <StageMessage
          onDismiss={round.dismissError}
          text={errorText}
          title="That did not go through"
        />
      )}
    </section>
  );
};
