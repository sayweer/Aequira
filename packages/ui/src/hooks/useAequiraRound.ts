import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  getPrivateStatePasswordError,
  toCircuitErrorMessage,
  toDeploymentErrorMessage,
} from '../deployment-errors.js';
import type { ProofMode } from '../proof-mode.js';
import type { RoundView } from '../round-format.js';
import {
  InputError,
  parseApplicationId,
  parseEligibilityThresholds,
  parseScore,
  type EligibilityThresholds,
} from '../round-inputs.js';
import {
  advancePhase,
  applyToRound,
  commitScore,
  deployRound,
  enrollApplicant as enrollApplicantCall,
  hasMatchingCommitment,
  joinRound,
  readLocalApplicantIdHex,
  readLocalReviewerIdHex,
  readRoundState,
  registerApplicant as registerApplicantCall,
  registerReviewer as registerReviewerCall,
  revealScore,
  type EnrollmentResult,
  type PhaseTransition,
  type RoundSession,
  type ScoreOpening,
} from '../round.js';
import { createRoundMemoryStore } from '../session-storage.js';
import { AEQUIRA_NETWORK_ID } from '../wallet.js';

const LEDGER_POLL_INTERVAL_MS = 4_000;
/** Consecutive failed reads before the page says the indexer is behind. */
const LEDGER_FAILURES_BEFORE_LAG = 3;

export type RoundActionName =
  | 'apply'
  | 'commit'
  | 'deploy'
  | 'enroll'
  | 'join'
  | 'phase'
  | 'register'
  | 'registerApplicant'
  | 'reveal';

export type RoundError = {
  readonly action: RoundActionName;
  readonly message: string;
};

export type CommittedScore = {
  readonly applicationIdHex: string;
  readonly score: number;
};

export type AequiraRound = {
  readonly address: string | null;
  readonly applicantIdHex: string | null;
  readonly busy: RoundActionName | null;
  readonly error: RoundError | null;
  /** True once several ledger reads in a row have failed. */
  readonly indexerLagging: boolean;
  readonly lastEnrollment: EnrollmentResult | null;
  /** The score the user last entered here. It stays in this tab. */
  readonly lastCommitted: CommittedScore | null;
  readonly lastOpening: ScoreOpening | null;
  readonly proofMode: ProofMode | null;
  readonly rememberedAddress: string | null;
  readonly reviewerIdHex: string | null;
  readonly view: RoundView | null;
  advance(transition: PhaseTransition): Promise<void>;
  apply(): Promise<void>;
  clear(): void;
  commit(applicationIdInput: string, scoreInput: string): Promise<void>;
  /** Resolves true once the round is open. */
  deploy(
    password: string,
    confirmation: string,
    maxIncomeBand: string,
    minGpaScaled: string,
  ): Promise<boolean>;
  dismissError(): void;
  enroll(incomeBandInput: string, gpaScaledInput: string, regionCodeInput: string): Promise<void>;
  /** The current error, if it came from one of these actions. */
  errorFor(actions: readonly RoundActionName[]): string | null;
  /** Resolves true once the round is open. */
  join(password: string, confirmation: string, addressInput: string): Promise<boolean>;
  refresh(): Promise<void>;
  registerApplicant(enrollmentLeafInput: string): Promise<void>;
  registerReviewer(reviewerIdInput: string): Promise<void>;
  reveal(applicationIdInput: string, scoreInput: string): Promise<void>;
};

/**
 * Input rejections carry safe, actionable text and are shown verbatim. RangeError
 * comes from the SDK validators, whose messages are equally safe. Everything else
 * is mapped, so no provider or extension detail reaches the page.
 */
const toActionErrorMessage = (error: unknown, fallback: (error: unknown) => string): string =>
  error instanceof InputError || error instanceof RangeError ? error.message : fallback(error);

export const useAequiraRound = (connectedApi: ConnectedAPI | null): AequiraRound => {
  const memory = useMemo(
    () => createRoundMemoryStore(() => window.localStorage, AEQUIRA_NETWORK_ID),
    [],
  );

  const [address, setAddress] = useState<string | null>(null);
  const [proofMode, setProofMode] = useState<ProofMode | null>(null);
  const [view, setView] = useState<RoundView | null>(null);
  const [indexerLagging, setIndexerLagging] = useState(false);
  const [busy, setBusy] = useState<RoundActionName | null>(null);
  const [error, setError] = useState<RoundError | null>(null);
  const [reviewerIdHex, setReviewerIdHex] = useState<string | null>(null);
  const [applicantIdHex, setApplicantIdHex] = useState<string | null>(null);
  const [lastEnrollment, setLastEnrollment] = useState<EnrollmentResult | null>(null);
  const [lastOpening, setLastOpening] = useState<ScoreOpening | null>(null);
  const [lastCommitted, setLastCommitted] = useState<CommittedScore | null>(null);
  const [applicationIdHexes, setApplicationIdHexes] = useState<readonly string[]>(
    () => memory.read().applicationIdHexes,
  );
  const [rememberedAddress, setRememberedAddress] = useState<string | null>(
    () => memory.read().contractAddress,
  );

  const sessionRef = useRef<RoundSession | null>(null);
  const attemptRef = useRef(0);
  // Render-time `busy` lags a fast second click; this does not.
  const busyRef = useRef(false);
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const ledgerFailuresRef = useRef(0);

  const clear = useCallback(() => {
    attemptRef.current += 1;
    busyRef.current = false;
    ledgerFailuresRef.current = 0;
    const session = sessionRef.current;
    sessionRef.current = null;

    setAddress(null);
    setProofMode(null);
    setView(null);
    setIndexerLagging(false);
    setBusy(null);
    setError(null);
    setReviewerIdHex(null);
    setApplicantIdHex(null);
    setLastEnrollment(null);
    setLastOpening(null);
    setLastCommitted(null);

    if (session !== null) {
      void session.close().catch(() => {
        // The in-memory password is cleared before cache invalidation is attempted.
      });
    }
  }, []);

  // The round only ever holds a session opened through this wallet, so losing or
  // switching the wallet must close it. The cleanup also covers unmount.
  useEffect(() => () => clear(), [clear, connectedApi]);

  // One read at a time, so a slow response can never overwrite a newer one. A
  // refresh requested mid-read (say, right after a phase change) runs once more
  // afterwards instead of being dropped until the next poll.
  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return;
    }

    refreshInFlightRef.current = true;

    try {
      do {
        refreshQueuedRef.current = false;
        const session = sessionRef.current;

        if (session === null) {
          break;
        }

        try {
          const nextView = await readRoundState(session, applicationIdHexes);

          // A read that outlived its round must not repaint the next one.
          if (sessionRef.current === session) {
            ledgerFailuresRef.current = 0;
            setIndexerLagging(false);
            setView(nextView);
          }
        } catch {
          // The indexer lags behind a fresh deployment; the poll retries.
          if (sessionRef.current === session) {
            ledgerFailuresRef.current += 1;
            setIndexerLagging(ledgerFailuresRef.current >= LEDGER_FAILURES_BEFORE_LAG);
          }
        }
      } while (refreshQueuedRef.current);
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [applicationIdHexes]);

  useEffect(() => {
    if (address === null) {
      return;
    }

    void refresh();
    const intervalId = window.setInterval(() => void refresh(), LEDGER_POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [address, refresh]);

  /** Adopts a freshly opened session, unless the attempt was superseded. */
  const adoptSession = useCallback(
    async (session: RoundSession, attempt: number): Promise<boolean> => {
      if (attemptRef.current !== attempt) {
        await session.close();
        return false;
      }

      sessionRef.current = session;
      setAddress(session.address);
      setProofMode(session.proofMode);
      memory.saveContractAddress(session.address);
      setRememberedAddress(session.address);

      try {
        setReviewerIdHex(await readLocalReviewerIdHex(session));
      } catch {
        // A missing reviewer pseudonym only disables prefilling the register form.
      }

      try {
        setApplicantIdHex(await readLocalApplicantIdHex(session));
      } catch {
        // A missing applicant identity only disables the enrollment display.
      }

      return true;
    },
    [memory],
  );

  const openSession = useCallback(
    async (
      action: 'deploy' | 'join',
      password: string,
      confirmation: string,
      open: (api: ConnectedAPI, password: string) => Promise<RoundSession>,
    ): Promise<boolean> => {
      if (connectedApi === null || busyRef.current) {
        return false;
      }

      const passwordError = getPrivateStatePasswordError(password, confirmation);

      if (passwordError !== null) {
        setError({ action, message: passwordError });
        return false;
      }

      busyRef.current = true;
      setError(null);
      setBusy(action);
      const attempt = attemptRef.current + 1;
      attemptRef.current = attempt;

      try {
        return await adoptSession(await open(connectedApi, password), attempt);
      } catch (caught) {
        if (attemptRef.current === attempt) {
          setAddress(null);
          setError({
            action,
            message:
              action === 'deploy'
                ? toDeploymentErrorMessage(caught)
                : toActionErrorMessage(caught, toCircuitErrorMessage),
          });
        }
        return false;
      } finally {
        if (attemptRef.current === attempt) {
          busyRef.current = false;
          setBusy(null);
        }
      }
    },
    [adoptSession, connectedApi],
  );

  /**
   * Runs one circuit call against the current session. Its result is applied
   * only if the same round is still open when the call settles: a call that
   * outlives a disconnect must not write into whatever replaced it.
   */
  const runCall = useCallback(
    async <Result>(
      action: RoundActionName,
      call: (session: RoundSession) => Promise<Result>,
      onSuccess?: (result: Result) => void,
    ): Promise<void> => {
      const session = sessionRef.current;

      if (session === null || busyRef.current) {
        return;
      }

      const attempt = attemptRef.current;
      const isCurrent = () => attemptRef.current === attempt && sessionRef.current === session;

      busyRef.current = true;
      setError(null);
      setBusy(action);

      try {
        const result = await call(session);

        if (isCurrent()) {
          onSuccess?.(result);
          await refresh();
        }
      } catch (caught) {
        if (isCurrent()) {
          setError({ action, message: toActionErrorMessage(caught, toCircuitErrorMessage) });
        }
      } finally {
        if (isCurrent()) {
          busyRef.current = false;
          setBusy(null);
        }
      }
    },
    [refresh],
  );

  const rememberApplicationId = useCallback(
    (applicationIdHex: string) => {
      memory.addApplicationId(applicationIdHex);
      setApplicationIdHexes(memory.read().applicationIdHexes);
    },
    [memory],
  );

  return {
    address,
    advance: (transition: PhaseTransition) =>
      runCall('phase', (session) => advancePhase(session, transition)),

    apply: () => runCall('apply', (session) => applyToRound(session)),

    applicantIdHex,
    busy,

    clear: useCallback(() => {
      clear();
      memory.clear();
      setApplicationIdHexes([]);
      setRememberedAddress(null);
    }, [clear, memory]),

    commit: (applicationIdInput: string, scoreInput: string) =>
      runCall(
        'commit',
        async (session) => {
          const applicationIdHex = parseApplicationId(applicationIdInput);
          const score = parseScore(scoreInput);
          const { opening } = await commitScore(session, { applicationIdHex, score });
          return { applicationIdHex, opening, score };
        },
        ({ applicationIdHex, opening, score }) => {
          rememberApplicationId(applicationIdHex);
          setLastOpening(opening);
          setLastCommitted({ applicationIdHex, score });
        },
      ),

    // The thresholds are validated before the session opens: a malformed
    // number is a form error the user can fix, not a deployment failure to be
    // mapped like a chain or wallet one.
    deploy: async (
      password: string,
      confirmation: string,
      maxIncomeBand: string,
      minGpaScaled: string,
    ) => {
      let thresholds: EligibilityThresholds;

      try {
        thresholds = parseEligibilityThresholds(maxIncomeBand, minGpaScaled);
      } catch (caught) {
        setError({
          action: 'deploy',
          message: toActionErrorMessage(caught, toCircuitErrorMessage),
        });
        return false;
      }

      return openSession('deploy', password, confirmation, (api, secret) =>
        deployRound(api, secret, thresholds),
      );
    },

    dismissError: () => setError(null),

    enroll: (incomeBandInput: string, gpaScaledInput: string, regionCodeInput: string) =>
      runCall(
        'enroll',
        (session) => enrollApplicantCall(session, incomeBandInput, gpaScaledInput, regionCodeInput),
        (enrollment) => {
          setApplicantIdHex(enrollment.applicantIdHex);
          setLastEnrollment(enrollment);
        },
      ),

    error,

    errorFor: (actions: readonly RoundActionName[]) =>
      error !== null && actions.includes(error.action) ? error.message : null,

    indexerLagging,

    join: (password: string, confirmation: string, addressInput: string) =>
      openSession('join', password, confirmation, (api, secret) =>
        joinRound(api, secret, addressInput),
      ),

    lastCommitted,
    lastEnrollment,
    lastOpening,
    proofMode,
    refresh,
    rememberedAddress,

    registerApplicant: (enrollmentLeafInput: string) =>
      runCall('registerApplicant', (session) =>
        registerApplicantCall(session, enrollmentLeafInput),
      ),

    registerReviewer: (reviewerIdInput: string) =>
      runCall('register', (session) => registerReviewerCall(session, reviewerIdInput)),

    reveal: (applicationIdInput: string, scoreInput: string) =>
      runCall(
        'reveal',
        async (session) => {
          const applicationIdHex = parseApplicationId(applicationIdInput);
          const score = parseScore(scoreInput);

          // Refuse locally rather than failing the contract's assertion and paying
          // for a proof. The browser can check the opening on its own.
          if (!(await hasMatchingCommitment(session, { applicationIdHex, score }))) {
            throw new InputError(
              'That score does not open the commitment recorded on chain for this application.',
            );
          }

          await revealScore(session, { applicationIdHex, score });
          return { applicationIdHex, score };
        },
        ({ applicationIdHex, score }) => {
          rememberApplicationId(applicationIdHex);
          setLastCommitted({ applicationIdHex, score });
        },
      ),

    reviewerIdHex,
    view,
  };
};
