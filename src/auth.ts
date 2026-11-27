import { CLIENT_ID, getBaseUrl } from './config.js';
import { loadPending, loadSession, savePending, saveSession, type Credentials } from './tokens.js';

export interface DeviceAuthorization {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

const REFRESH_MARGIN_MS = 30_000;

async function postJson(path: string, body: unknown): Promise<{ ok: boolean; status: number; json: any }> {
  const r = await fetch(`${getBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
}

/** Start an OAuth 2.0 device authorization (RFC 8628). */
export async function startLogin(scopes: string[]): Promise<DeviceAuthorization> {
  const r = await postJson('/oauth/device_authorization', { client_id: CLIENT_ID, scope: scopes.join(' ') });
  if (!r.ok) throw new Error(`Could not start login (HTTP ${r.status}).`);
  const auth = r.json as DeviceAuthorization;
  await savePending({
    device_code: auth.device_code,
    scopes,
    expires_at: new Date(Date.now() + auth.expires_in * 1000).toISOString(),
    interval: auth.interval,
  });
  return auth;
}

type ExchangeResult = { status: 'approved'; session: Credentials } | { status: 'pending' } | { status: 'failed'; reason: string };

/** One attempt to exchange the pending device code for a token. */
export async function tryFinishLogin(): Promise<ExchangeResult> {
  const pending = await loadPending();
  if (!pending) return { status: 'failed', reason: 'No login in progress. Run `lola login`.' };
  if (Date.parse(pending.expires_at) < Date.now()) {
    await savePending(null);
    return { status: 'failed', reason: 'The login link expired. Start again.' };
  }
  const r = await postJson('/oauth/token', {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    device_code: pending.device_code,
    client_id: CLIENT_ID,
  });
  if (r.ok && r.json?.access_token) {
    const session = await storeToken(r.json as TokenResponse, pending.scopes);
    await savePending(null);
    return { status: 'approved', session };
  }
  const err = r.json?.error;
  if (err === 'authorization_pending' || err === 'slow_down') return { status: 'pending' };
  await savePending(null);
  if (err === 'access_denied') return { status: 'failed', reason: 'The login was declined.' };
  if (err === 'expired_token') return { status: 'failed', reason: 'The login link expired. Start again.' };
  return { status: 'failed', reason: `Login failed (HTTP ${r.status}).` };
}

/** Poll until the user approves, declines, or the code expires. */
export async function waitForLogin(auth: DeviceAuthorization): Promise<Credentials> {
  let intervalMs = Math.max(1, auth.interval) * 1000;
  const deadline = Date.now() + auth.expires_in * 1000;
  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, intervalMs));
    const result = await tryFinishLogin();
    if (result.status === 'approved') return result.session;
    if (result.status === 'failed') throw new Error(result.reason);
  }
  await savePending(null);
  throw new Error('The login link expired. Run `lola login` again.');
}

async function storeToken(token: TokenResponse, scopes?: string[]): Promise<Credentials> {
  const session: Credentials = {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: new Date(Date.now() + (token.expires_in ?? 900) * 1000).toISOString(),
    ...(scopes?.length ? { scopes } : {}),
  };
  try {
    const me = await fetch(`${getBaseUrl()}/skill-accounts/whoami`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (me.ok) {
      const j: any = await me.json();
      if (j?.data?.owner?.email) session.owner_email = j.data.owner.email;
      if (j?.data?.skill_account?.id) session.skill_account_id = j.data.skill_account.id;
    }
  } catch {
    /* account details are optional */
  }
  await saveSession(session);
  return session;
}

/** Return a valid access token, refreshing it if it is about to expire. Null when logged out. */
export async function getAccessToken(opts: { forceRefresh?: boolean } = {}): Promise<string | null> {
  const session = await loadSession();
  if (!session) {
    // A login started from an agent may have been approved in the meantime.
    const finished = await tryFinishLogin().catch(() => null);
    return finished?.status === 'approved' ? finished.session.access_token : null;
  }
  if (!opts.forceRefresh && Date.parse(session.expires_at) - REFRESH_MARGIN_MS > Date.now()) {
    return session.access_token;
  }
  const r = await postJson('/oauth/refresh', { refresh_token: session.refresh_token });
  if (!r.ok || !r.json?.access_token) {
    throw new Error('Your LOLA session has expired. Run `lola login` again.');
  }
  const next: Credentials = {
    ...session,
    access_token: r.json.access_token,
    refresh_token: r.json.refresh_token ?? session.refresh_token,
    expires_at: new Date(Date.now() + (r.json.expires_in ?? 900) * 1000).toISOString(),
  };
  await saveSession(next);
  return next.access_token;
}

/** Revoke the current session on the server (best effort). */
export async function revokeSession(): Promise<number | null> {
  const session = await loadSession();
  if (!session?.skill_account_id) return null;
  const token = await getAccessToken().catch(() => session.access_token);
  const r = await fetch(`${getBaseUrl()}/skill-accounts/${encodeURIComponent(session.skill_account_id)}/revoke`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.status;
}
