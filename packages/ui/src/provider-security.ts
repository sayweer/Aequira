const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

export const normalizeLocalProofServerUrl = (value: string): string => {
  const proofServerUrl = new URL(value);

  if (
    !['http:', 'https:'].includes(proofServerUrl.protocol) ||
    !LOOPBACK_HOSTS.has(proofServerUrl.hostname) ||
    proofServerUrl.username !== '' ||
    proofServerUrl.password !== ''
  ) {
    throw new Error('Proof server must use a credential-free local loopback address');
  }

  return proofServerUrl.toString().replace(/\/$/, '');
};
