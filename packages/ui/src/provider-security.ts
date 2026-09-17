// The spellings a local proof server may be reached by. The wallet picks one —
// Lace reports `localhost` — so the deployed Content-Security-Policy has to
// allow every one of them under connect-src. A csp test pins that.
export const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', '[::1]', 'localhost'];

export const normalizeLocalProofServerUrl = (value: string): string => {
  const proofServerUrl = new URL(value);

  if (
    !['http:', 'https:'].includes(proofServerUrl.protocol) ||
    !LOOPBACK_HOSTS.includes(proofServerUrl.hostname) ||
    proofServerUrl.username !== '' ||
    proofServerUrl.password !== ''
  ) {
    throw new Error('Proof server must use a credential-free local loopback address');
  }

  return proofServerUrl.toString().replace(/\/$/, '');
};
