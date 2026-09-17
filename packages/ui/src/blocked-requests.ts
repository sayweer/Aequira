// Remembers connections the browser refused under this page's Content-Security-Policy.
//
// A refused connection reaches application code as a bare `TypeError: Failed to
// fetch`, which names neither the host nor the reason. That cost a long hunt
// once: the wallet reports its Preprod indexer and node on hosts the deployed
// policy did not list, every call to them was refused, and the failure was
// reported as an unreachable proof server. The browser knows exactly what it
// blocked and says so in `securitypolicyviolation`, so this keeps that answer
// for the error mapper to use instead of guessing.
//
// Only connection directives are recorded. A blocked stylesheet or image says
// nothing about why a transaction failed, and treating it as a cause would
// reintroduce the misdiagnosis this module exists to remove.

const CONNECTION_DIRECTIVES = new Set(['connect-src', 'default-src']);

/** Bounded so a page that blocks on every poll cannot grow this without limit. */
const MAX_RECORDED_ORIGINS = 8;

const recordedOrigins = new Set<string>();

/** The origin behind a blocked URI, or the URI itself when it cannot be parsed. */
export const toBlockedOrigin = (blockedUri: string): string => {
  try {
    return new URL(blockedUri).origin;
  } catch {
    return blockedUri;
  }
};

export const recordBlockedRequest = (blockedUri: string, effectiveDirective: string): void => {
  if (!CONNECTION_DIRECTIVES.has(effectiveDirective) || blockedUri === '') {
    return;
  }

  const origin = toBlockedOrigin(blockedUri);

  if (recordedOrigins.size >= MAX_RECORDED_ORIGINS && !recordedOrigins.has(origin)) {
    return;
  }

  recordedOrigins.add(origin);
};

export const blockedRequestOrigins = (): readonly string[] => [...recordedOrigins];

export const startRecordingBlockedRequests = (): void => {
  document.addEventListener('securitypolicyviolation', (event) => {
    recordBlockedRequest(event.blockedURI, event.effectiveDirective);
  });
};
