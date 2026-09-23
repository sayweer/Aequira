import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { blockedRequestOrigins } from '../blocked-requests.js';
import {
  getPrivateStatePasswordError,
  toCircuitErrorMessage,
  toDeploymentErrorMessage,
} from '../deployment-errors.js';
import type { LastScore } from '../privacy-view.js';
import type { ProofMode } from '../proof-mode.js';
import type { LocalIdentity, LocalStatus, RoundView } from '../round-format.js';
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
  importEnrollmentReceipt,
  joinRound,
  readLocalIdentity,
  readRoundState,
  registerApplicant as registerApplicantCall,
  registerReviewer as registerReviewerCall,
  revealScore,
  type PhaseTransition,
  type RoundSession,
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
  | 'importReceipt'
  | 'join'
  | 'phase'
  | 'register'
  | 'registerApplicant'
  | 'reveal';

export type RoundError = {
  readonly action: RoundActionName;
  readonly message: string;
};

/** Every action resolves true once it succeeded and its result was applied. */
export type AequiraRound = {
  readonly address: string | null;
  readonly busy: RoundActionName | null;
  readonly error: RoundError | null;
  /** True once several ledger reads in a row have failed. */
  readonly indexerLagging: boolean;
  /**
   * The receipt the last applicant registration produced. Private: held in
   * memory only, until dismissed or the round closes.
   */
  readonly issuedReceipt: string | null;
  /** This browser's own IDs, known as soon as the round opens. */
  readonly identity: LocalIdentity | null;
  /** The score last committed or revealed here. It stays in this tab. */
  readonly lastScore: LastScore | null;
  /** Where this browser stands against the ledger, once it has been read. */
  readonly local: LocalStatus | null;
  readonly proofMode: ProofMode | null;
  readonly rememberedAddress: string | null;
  readonly view: RoundView | null;
  advance(transition: PhaseTransition): Promise<boolean>;
  apply(): Promise<boolean>;
  clear(): void;
  commit(applicationIdInput: string, scoreInput: string): Promise<boolean>;
  /** Resolves true once the round is open. */
  deploy(
    password: string,
    confirmation: string,
    maxIncomeBand: string,
    minGpaScaled: string,
  ): Promise<boolean>;
  dismissError(): void;
  dismissReceipt(): void;
  /** The current error, if it came from one of these actions. */
  errorFor(actions: readonly RoundActionName[]): string | null;
  /** Resolves true once the receipt is stored. */
  importReceipt(receiptText: string): Promise<boolean>;
  /** Resolves true once the round is open. */
  join(password: string, confirmation: string, addressInput: string): Promise<boolean>;
  refresh(): Promise<void>;
  registerApplicant(
    applicantIdInput: string,
    incomeBandInput: string,
    gpaScaledInput: string,
    regionCodeInput: string,
  ): Promise<boolean>;
  registerReviewer(reviewerIdInput: string): Promise<boolean>;
  reveal(applicationIdInput: string, scoreInput: string): Promise<boolean>;
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
  const [identity, setIdentity] = useState<LocalIdentity | null>(null);
  const [issuedReceipt, setIssuedReceipt] = useState<string | null>(null);
  const [lastScore, setLastScore] = useState<LastScore | null>(null);
  const [rememberedAddress, setRememberedAddress] = useState<string | null>(
    () => memory.read().contractAddress,
  );

  const sessionRef = useRef<RoundSession | null>(null);
  // Read by the poll, which must not restart every time the identity changes.
  const identityRef = useRef<LocalIdentity | null>(null);
  const attemptRef = useRef(0);
  // Render-time `busy` lags a fast second click; this does not.
  const busyRef = useRef(false);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const refreshQueuedRef = useRef(false);
  const ledgerFailuresRef = useRef(0);

  const clear = useCallback(() => {
    attemptRef.current += 1;
    busyRef.current = false;
    ledgerFailuresRef.current = 0;
    identityRef.current = null;
    const session = sessionRef.current;
    sessionRef.current = null;

    setAddress(null);
    setProofMode(null);
    setView(null);
    setIndexerLagging(false);
    setBusy(null);
    setError(null);
    setIdentity(null);
    setIssuedReceipt(null);
    setLastScore(null);

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
  // afterwards instead of being dropped until the next poll, and its caller
  // waits for that read: a call that just landed must not hand its button back
  // while the screen still shows the ledger from before it.
  const refresh = useCallback((): Promise<void> => {
    if (refreshInFlightRef.current !== null) {
      refreshQueuedRef.current = true;
      return refreshInFlightRef.current;
    }

    // Deferred so the ref is set before the loop can finish and clear it.
    const read = Promise.resolve()
      .then(async () => {
        do {
          refreshQueuedRef.current = false;
          const session = sessionRef.current;

          if (session === null) {
            break;
          }

          try {
            const nextView = await readRoundState(session, identityRef.current);

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
      })
      .finally(() => {
        refreshInFlightRef.current = null;
      });
    refreshInFlightRef.current = read;

    return read;
  }, []);

  useEffect(() => {
    if (address === null) {
      return;
    }

    void refresh();
    const intervalId = window.setInterval(() => void refresh(), LEDGER_POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [address, refresh]);

  const loadIdentity = useCallback(async (session: RoundSession): Promise<void> => {
    try {
      const next = await readLocalIdentity(session);

      if (sessionRef.current === session) {
        identityRef.current = next;
        setIdentity(next);
      }
    } catch {
      // Without readable private state the page shows the ledger and disables
      // every action that would need a secret.
    }
  }, []);

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
      await loadIdentity(session);
      await refresh();

      return true;
    },
    [loadIdentity, memory, refresh],
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
                ? toDeploymentErrorMessage(caught, blockedRequestOrigins())
                : toActionErrorMessage(caught, (failure) =>
                    toCircuitErrorMessage(failure, blockedRequestOrigins()),
                  ),
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
   * outlives a disconnect must not write into whatever replaced it. Resolves
   * true when the call succeeded and its result was applied.
   */
  const runCall = useCallback(
    async <Result>(
      action: RoundActionName,
      call: (session: RoundSession) => Promise<Result>,
      onSuccess?: (result: Result, session: RoundSession) => void | Promise<void>,
    ): Promise<boolean> => {
      const session = sessionRef.current;

      if (session === null || busyRef.current) {
        return false;
      }

      const attempt = attemptRef.current;
      const isCurrent = () => attemptRef.current === attempt && sessionRef.current === session;

      busyRef.current = true;
      setError(null);
      setBusy(action);

      try {
        const result = await call(session);

        if (!isCurrent()) {
          return false;
        }

        await onSuccess?.(result, session);
        await refresh();
        return true;
      } catch (caught) {
        if (isCurrent()) {
          setError({
            action,
            message: toActionErrorMessage(caught, (failure) =>
              toCircuitErrorMessage(failure, blockedRequestOrigins()),
            ),
          });
        }
        return false;
      } finally {
        if (isCurrent()) {
          busyRef.current = false;
          setBusy(null);
        }
      }
    },
    [refresh],
  );

  return {
    address,
    advance: (transition: PhaseTransition) =>
      runCall('phase', (session) => advancePhase(session, transition)),

    // The ledger shows the application once it lands; the ID itself was already
    // derived with the identity, so there is nothing else to keep.
    apply: () => runCall('apply', (session) => applyToRound(session)),

    busy,

    clear: useCallback(() => {
      clear();
      memory.clear();
      setRememberedAddress(null);
    }, [clear, memory]),

    commit: (applicationIdInput: string, scoreInput: string) =>
      runCall(
        'commit',
        (session) =>
          commitScore(session, {
            applicationIdHex: parseApplicationId(applicationIdInput),
            score: parseScore(scoreInput),
          }),
        (opening) => setLastScore({ ...opening, stage: 'committed' }),
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
          message: toActionErrorMessage(caught, (failure) =>
            toCircuitErrorMessage(failure, blockedRequestOrigins()),
          ),
        });
        return false;
      }

      return openSession('deploy', password, confirmation, (api, secret) =>
        deployRound(api, secret, thresholds),
      );
    },

    dismissError: () => setError(null),

    dismissReceipt: () => setIssuedReceipt(null),

    error,

    errorFor: (actions: readonly RoundActionName[]) =>
      error !== null && actions.includes(error.action) ? error.message : null,

    identity,

    importReceipt: (receiptText: string) =>
      runCall(
        'importReceipt',
        (session) => importEnrollmentReceipt(session, receiptText),
        async (_result, session) => {
          await loadIdentity(session);
        },
      ),

    indexerLagging,
    issuedReceipt,

    join: (password: string, confirmation: string, addressInput: string) =>
      openSession('join', password, confirmation, (api, secret) =>
        joinRound(api, secret, addressInput),
      ),

    lastScore,
    local: view?.local ?? null,
    proofMode,
    refresh,
    rememberedAddress,

    registerApplicant: (
      applicantIdInput: string,
      incomeBandInput: string,
      gpaScaledInput: string,
      regionCodeInput: string,
    ) =>
      runCall(
        'registerApplicant',
        (session) =>
          registerApplicantCall(
            session,
            applicantIdInput,
            incomeBandInput,
            gpaScaledInput,
            regionCodeInput,
          ),
        (receipt) => setIssuedReceipt(receipt),
      ),

    registerReviewer: (reviewerIdInput: string) =>
      runCall('register', (session) => registerReviewerCall(session, reviewerIdInput)),

    reveal: (applicationIdInput: string, scoreInput: string) =>
      runCall(
        'reveal',
        (session) =>
          revealScore(session, {
            applicationIdHex: parseApplicationId(applicationIdInput),
            score: parseScore(scoreInput),
          }),
        (opening) => setLastScore({ ...opening, stage: 'revealed' }),
      ),

    view,
  };
};
