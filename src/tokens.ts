import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { getCredentialsFile } from './config.js';

export interface Credentials {
  access_token: string;
  refresh_token: string;
  /** ISO timestamp at which access_token expires. */
  expires_at: string;
  scopes?: string[];
  owner_email?: string;
  skill_account_id?: string;
}

/** A device-flow login that has been started but not yet approved. */
export interface PendingLogin {
  device_code: string;
  scopes: string[];
  expires_at: string;
  interval: number;
}

interface CredentialsFile {
  session?: Credentials;
  pending?: PendingLogin;
}

async function readAll(): Promise<CredentialsFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(getCredentialsFile(), 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as CredentialsFile) : {};
  } catch (err: any) {
    if (err?.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeAll(file: CredentialsFile): Promise<void> {
  const path = getCredentialsFile();
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await fs.writeFile(path, JSON.stringify(file, null, 2), { mode: 0o600 });
  await fs.chmod(path, 0o600);
}

export async function loadSession(): Promise<Credentials | null> {
  return (await readAll()).session ?? null;
}

export async function saveSession(session: Credentials): Promise<void> {
  const file = await readAll();
  file.session = session;
  await writeAll(file);
}

export async function clearSession(): Promise<boolean> {
  const file = await readAll();
  const had = !!file.session;
  delete file.session;
  delete file.pending;
  await writeAll(file);
  return had;
}

export async function loadPending(): Promise<PendingLogin | null> {
  return (await readAll()).pending ?? null;
}

export async function savePending(pending: PendingLogin | null): Promise<void> {
  const file = await readAll();
  if (pending) file.pending = pending;
  else delete file.pending;
  await writeAll(file);
}
