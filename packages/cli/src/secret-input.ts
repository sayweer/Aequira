import { createInterface } from 'node:readline/promises';
import { stderr, stdin } from 'node:process';
import { Writable } from 'node:stream';

import { validatePassword } from '@midnight-ntwrk/midnight-js-utils';

export type SecretPrompt = (label: string) => Promise<string>;

export type SecretPromptStreams = {
  readonly input?: NodeJS.ReadableStream & { readonly isTTY?: boolean };
  readonly output?: NodeJS.WritableStream & { readonly isTTY?: boolean };
};

export const promptHiddenSecret = async (
  label: string,
  streams: SecretPromptStreams = {},
): Promise<string> => {
  const input = streams.input ?? stdin;
  const output = streams.output ?? stderr;

  if (input.isTTY !== true || output.isTTY !== true) {
    throw new Error(
      'Secret input requires an interactive TTY; stdin pipes and redirects are refused',
    );
  }

  output.write(label);
  const mutedOutput = new Writable({
    write(_chunk, _encoding, callback): void {
      callback();
    },
  });
  const readline = createInterface({
    input,
    output: mutedOutput,
    terminal: true,
  });

  try {
    return await readline.question('');
  } finally {
    readline.close();
    output.write('\n');
  }
};

export const parseWalletSeed = (value: string): Uint8Array => {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('Wallet seed must be exactly 64 hexadecimal characters');
  }

  return Buffer.from(value, 'hex');
};

export type RuntimeSecrets = {
  readonly privateStatePassword: string;
  readonly walletSeed: Uint8Array;
};

export const readRuntimeSecrets = async (
  promptSecret: SecretPrompt = promptHiddenSecret,
): Promise<RuntimeSecrets> => {
  const walletSeed = parseWalletSeed(await promptSecret('Wallet seed (64 hex): '));

  try {
    const privateStatePassword = await promptSecret('Private-state storage password: ');
    validatePassword(privateStatePassword);

    return {
      privateStatePassword,
      walletSeed,
    };
  } catch (error) {
    walletSeed.fill(0);
    throw error;
  }
};
