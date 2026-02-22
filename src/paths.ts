import { join } from 'node:path';
import { homedir } from 'node:os';

const APP_NAME = 'claude-memory';

export function getDataDir(): string {
  const xdg = process.env['XDG_DATA_HOME'];
  const base = xdg ?? join(process.env['HOME'] ?? homedir(), '.local', 'share');
  return join(base, APP_NAME);
}

export function getObservationsPath(): string {
  return join(getDataDir(), 'observations.json');
}

export function getIdentityDir(): string {
  return join(getDataDir(), 'identity');
}
