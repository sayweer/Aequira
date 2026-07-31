// Decides where a proof is generated.
//
// Proving consumes the private witness — the reviewer secret, the score, and the
// salt — so the destination is a privacy decision, not a configuration detail.
// Three destinations are acceptable, in this order of preference:
//
//   wallet       The wallet proves, using key material we hand it. The witness
//                never leaves the extension the user already trusts, and a hosted
//                page needs no local server. `Configuration.proverServerUri` is
//                deprecated in favour of this.
//   same-origin  Development only. Vite forwards /__aequira_local to the loopback
//                proof server, so the request never appears as cross-origin.
//   loopback     A proof server on this machine. Anything non-local is rejected.
//
// This module is compiled by the test build, so `import.meta.env` is not
// available here: the caller reads it and passes the result in.

import { normalizeLocalProofServerUrl } from './provider-security.js';

export const DEFAULT_PROOF_SERVER_URL = 'http://127.0.0.1:6300';
export const DEVELOPMENT_PROOF_SERVER_PATH = '/__aequira_local';

export type ProofMode =
  | { readonly kind: 'loopback'; readonly url: string }
  | { readonly kind: 'same-origin'; readonly url: string }
  | { readonly kind: 'wallet' };

export type ProofModeInput = {
  readonly configuredUrl?: string | undefined;
  /** Whether the connected wallet exposes the DApp connector proving API. */
  readonly hasProvingProvider: boolean;
  readonly isDev: boolean;
  readonly origin: string;
  readonly walletProverUri?: string | undefined;
};

export const selectProofMode = ({
  configuredUrl,
  hasProvingProvider,
  isDev,
  origin,
  walletProverUri,
}: ProofModeInput): ProofMode => {
  if (isDev) {
    return { kind: 'same-origin', url: `${origin}${DEVELOPMENT_PROOF_SERVER_PATH}` };
  }

  // An explicitly configured URL wins, so an operator can always pin the prover
  // — but it still has to pass the loopback check below.
  const explicitUrl = configuredUrl?.trim();

  if (explicitUrl !== undefined && explicitUrl.length > 0) {
    return { kind: 'loopback', url: normalizeLocalProofServerUrl(explicitUrl) };
  }

  if (hasProvingProvider) {
    return { kind: 'wallet' };
  }

  return {
    kind: 'loopback',
    url: normalizeLocalProofServerUrl(walletProverUri?.trim() || DEFAULT_PROOF_SERVER_URL),
  };
};

export const describeProofMode = (mode: ProofMode): string => {
  switch (mode.kind) {
    case 'loopback':
      return 'Proving on this machine';
    case 'same-origin':
      return 'Proving on this machine (dev proxy)';
    case 'wallet':
      return 'Proving in Lace';
  }
};
