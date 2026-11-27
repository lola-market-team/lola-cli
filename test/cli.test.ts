import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from '../src/args.js';
import { getBaseUrl, getMcpUrl } from '../src/config.js';
import { clearSession, loadPending, loadSession, savePending, saveSession } from '../src/tokens.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'lola-cli-test-'));
  process.env['LOLA_CREDENTIALS_FILE'] = join(dir, 'credentials.json');
});

afterEach(async () => {
  delete process.env['LOLA_CREDENTIALS_FILE'];
  delete process.env['LOLA_BASE_URL'];
  await fs.rm(dir, { recursive: true, force: true });
});

const session = {
  access_token: 'a',
  refresh_token: 'r',
  expires_at: new Date(Date.now() + 60_000).toISOString(),
};

describe('session store', () => {
  it('is empty before login', async () => {
    expect(await loadSession()).toBeNull();
    expect(await loadPending()).toBeNull();
  });

  it('round-trips a session and writes the file with mode 0600', async () => {
    await saveSession(session);
    expect(await loadSession()).toEqual(session);
    const mode = (await fs.stat(process.env['LOLA_CREDENTIALS_FILE']!)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('logout clears the session and any pending login', async () => {
    await saveSession(session);
    await savePending({ device_code: 'd', scopes: ['x'], expires_at: session.expires_at, interval: 5 });
    expect(await clearSession()).toBe(true);
    expect(await loadSession()).toBeNull();
    expect(await loadPending()).toBeNull();
    expect(await clearSession()).toBe(false);
  });

  it('keeps unrelated keys in an existing credentials file', async () => {
    await fs.writeFile(process.env['LOLA_CREDENTIALS_FILE']!, JSON.stringify({ other: 1 }));
    await saveSession(session);
    const raw = JSON.parse(await fs.readFile(process.env['LOLA_CREDENTIALS_FILE']!, 'utf8'));
    expect(raw.other).toBe(1);
  });
});

describe('config', () => {
  it('defaults to production', () => {
    expect(getBaseUrl()).toBe('https://api.lola.market');
    expect(getMcpUrl()).toBe('https://api.lola.market/lola-mcp');
  });

  it('accepts https and localhost, strips trailing slashes', () => {
    process.env['LOLA_BASE_URL'] = 'https://example.org/';
    expect(getBaseUrl()).toBe('https://example.org');
    process.env['LOLA_BASE_URL'] = 'http://localhost:8055';
    expect(getBaseUrl()).toBe('http://localhost:8055');
  });

  it('refuses plaintext http for remote hosts', () => {
    process.env['LOLA_BASE_URL'] = 'http://example.org';
    expect(() => getBaseUrl()).toThrow(/plaintext/);
  });
});

describe('parseArgs', () => {
  it('treats missing input as no arguments', () => {
    expect(parseArgs(undefined)).toEqual({});
    expect(parseArgs('  ')).toEqual({});
  });

  it('parses a JSON object', () => {
    expect(parseArgs('{"q":"drill","limit":5}')).toEqual({ q: 'drill', limit: 5 });
  });

  it('rejects invalid JSON, arrays and scalars', () => {
    expect(() => parseArgs('{q:1}')).toThrow(/valid JSON/);
    expect(() => parseArgs('[1]')).toThrow(/object/);
    expect(() => parseArgs('5')).toThrow(/object/);
  });
});
