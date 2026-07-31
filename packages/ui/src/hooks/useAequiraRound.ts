import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  getPrivateStatePasswordError,
  toCircuitErrorMessage,
  toDeploymentErrorMessage,
} from '../deployment-errors.js';
import type { ProofMode } from '../proof-mode.js';
import type { RoundView } from '../round-format.js';
import { InputError, parseApplicationId, parseScore } from '../round-inputs.js';
import {
  advancePhase,
  commitScore,
  deployRound,
  hasMatchingCommitment,
  joinRound,
  readLocalReviewerIdHex,
  readRoundState,
  registerReviewer as registerReviewerCall,
  revealScore,
  type PhaseTransition,
  type RoundSession,
  type ScoreOpening,
} from '../round.js';
import { createRoundMemoryStore } from '../session-storage.js';
import { AEQUIRA_NETWORK_ID } from '../wallet.js';

const LEDGER_POLL_INTERVAL_MS = 4_000;

export type RoundActionName = 'commit' | 'deploy' | 'join' | 'phase' | 'register' | 'reveal';

export type CommittedScore = {
  readonly applicationIdHex: string;
  readonly score: number;
};

export type AequiraRound = {
  readonly address: string | null;
  readonly busy: RoundActionName | null;
  readonly error: string | null;
  /** The score the user last entered here. It stays in this tab. */
  readonly lastCommitted: CommittedScore | null;
  readonly lastOpening: ScoreOpening | null;
  readonly proofMode: ProofMode | null;
  readonly rememberedAddress: string | null;
  readonly reviewerIdHex: string | null;
  readonly view: RoundView | null;
  advance(transition: PhaseTransition): Promise<void>;
  clear(): void;
  commit(applicationIdInput: string, scoreInput: string): Promise<void>;
  deploy(password: string, confirmation: string): Promise<void>;
  dismissError(): void;
  join(password: string, confirmation: string, addressInput: string): Promise<void>;
  refresh(): Promise<void>;
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
  const memory = useMemo(() => createRoundMemoryStore(window.localStorage, AEQUIRA_NETWORK_ID), []);

  const [address, setAddress] = useState<string | null>(null);
  const [proofMode, setProofMode] = useState<ProofMode | null>(null);
  const [view, setView] = useState<RoundView | null>(null);
  const [busy, setBusy] = useState<RoundActionName | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewerIdHex, setReviewerIdHex] = useState<string | null>(null);
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

  const clear = useCallback(() => {
    attemptRef.current += 1;
    const session = sessionRef.current;
    sessionRef.current = null;

    setAddress(null);
    setProofMode(null);
    setView(null);
    setBusy(null);
    setError(null);
    setReviewerIdHex(null);
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

  const refresh = useCallback(async () => {
    const session = sessionRef.current;

    if (session === null) {
      return;
    }

    try {
      setView(await readRoundState(session, applicationIdHexes));
    } catch {
      // The indexer lags behind a fresh deployment; the poll retries.
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
    async (session: RoundSession, attempt: number): Promise<void> => {
      if (attemptRef.current !== attempt) {
        await session.close();
        return;
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
    },
    [memory],
  );

  const openSession = useCallback(
    async (
      action: RoundActionName,
      password: string,
      confirmation: string,
      open: (api: ConnectedAPI, password: string) => Promise<RoundSession>,
    ): Promise<void> => {
      if (connectedApi === null || busy !== null) {
        return;
      }

      const passwordError = getPrivateStatePasswordError(password, confirmation);

      if (passwordError !== null) {
        setError(passwordError);
        return;
      }

      setError(null);
      setBusy(action);
      const attempt = attemptRef.current + 1;
      attemptRef.current = attempt;

      try {
        await adoptSession(await open(connectedApi, password), attempt);
      } catch (caught) {
        if (attemptRef.current === attempt) {
          setAddress(null);
          setError(
            action === 'deploy'
              ? toDeploymentErrorMessage(caught)
              : toActionErrorMessage(caught, toCircuitErrorMessage),
          );
        }
      } finally {
        if (attemptRef.current === attempt) {
          setBusy(null);
        }
      }
    },
    [adoptSession, busy, connectedApi],
  );

  const runCall = useCallback(
    async (
      action: RoundActionName,
      call: (session: RoundSession) => Promise<void>,
    ): Promise<void> => {
      const session = sessionRef.current;

      if (session === null || busy !== null) {
        return;
      }

      setError(null);
      setBusy(action);

      try {
        await call(session);
        await refresh();
      } catch (caught) {
        setError(toActionErrorMessage(caught, toCircuitErrorMessage));
      } finally {
        setBusy(null);
      }
    },
    [busy, refresh],
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
      runCall('phase', async (session) => {
        await advancePhase(session, transition);
      }),
    busy,

    clear: useCallback(() => {
      clear();
      memory.clear();
      setApplicationIdHexes([]);
      setRememberedAddress(null);
    }, [clear, memory]),

    commit: (applicationIdInput: string, scoreInput: string) =>
      runCall('commit', async (session) => {
        const applicationIdHex = parseApplicationId(applicationIdInput);
        const score = parseScore(scoreInput);
        const { opening } = await commitScore(session, { applicationIdHex, score });

        rememberApplicationId(applicationIdHex);
        setLastOpening(opening);
        setLastCommitted({ applicationIdHex, score });
      }),

    deploy: (password: string, confirmation: string) =>
      openSession('deploy', password, confirmation, deployRound),

    dismissError: () => setError(null),

    error,

    join: (password: string, confirmation: string, addressInput: string) =>
      openSession('join', password, confirmation, (api, secret) =>
        joinRound(api, secret, addressInput),
      ),

    lastCommitted,
    lastOpening,
    proofMode,
    refresh,
    rememberedAddress,

    registerReviewer: (reviewerIdInput: string) =>
      runCall('register', async (session) => {
        await registerReviewerCall(session, reviewerIdInput);
      }),

    reveal: (applicationIdInput: string, scoreInput: string) =>
      runCall('reveal', async (session) => {
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
        rememberApplicationId(applicationIdHex);
        setLastCommitted({ applicationIdHex, score });
      }),

    reviewerIdHex,
    view,
  };
};
