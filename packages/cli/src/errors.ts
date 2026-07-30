import { homedir } from 'node:os';

const redactLiteral = (value: string, literal: string, replacement: string): string =>
  literal.length === 0 ? value : value.replaceAll(literal, replacement);

export const redactErrorMessage = (error: unknown): string => {
  const rawMessage = error instanceof Error ? error.message : 'Unknown CLI error';
  const projectDirectory = process.cwd();
  const homeDirectory = homedir();
  const withoutProjectPath = redactLiteral(rawMessage, projectDirectory, '<project-directory>');

  return redactLiteral(withoutProjectPath, homeDirectory, '<home-directory>');
};
