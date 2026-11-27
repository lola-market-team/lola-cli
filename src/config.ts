import { homedir } from 'node:os';
import { join } from 'node:path';
import pkg from '../package.json' with { type: 'json' };

export const VERSION: string = pkg.version;

/** OAuth client id this CLI registers its device-flow logins under. */
export const CLIENT_ID = 'lola-cli';

/**
 * Scopes requested by `lola login` when none are given. The server decides
 * which tools an account actually gets; this only bounds what the token
 * may do.
 */
export const DEFAULT_SCOPES = ['browse-listings', 'manage-items', 'onboard-item', 'manage-messages'];

export function getBaseUrl(): string {
  const raw = (process.env['LOLA_BASE_URL'] ?? 'https://api.lola.market').replace(/\/+$/, '');
  const u = new URL(raw);
  const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !isLocal) {
    throw new Error(`Refusing plaintext LOLA_BASE_URL=${raw}. Use https:// (or localhost for development).`);
  }
  return raw;
}

export function getMcpUrl(): string {
  return `${getBaseUrl()}/lola-mcp`;
}

export function getCredentialsFile(): string {
  return process.env['LOLA_CREDENTIALS_FILE'] ?? join(homedir(), '.config', 'lola', 'credentials.json');
}
