import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { getAccessToken } from './auth.js';
import { getMcpUrl, VERSION } from './config.js';

export class NotLoggedInError extends Error {
  constructor() {
    super('Not logged in. Run `lola login` first.');
  }
}

function isAuthError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err);
  return /\b401\b|unauthori[sz]ed|invalid.?token/i.test(msg);
}

async function connect(token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(getMcpUrl()), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'lola-cli', version: VERSION });
  await client.connect(transport);
  return client;
}

/**
 * Run `fn` against the hosted LOLA MCP server with the stored session.
 * Retries once with a refreshed token if the server rejects the current one.
 */
export async function withRemote<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new NotLoggedInError();
  let client: Client | undefined;
  try {
    client = await connect(token);
    return await fn(client);
  } catch (err) {
    if (!isAuthError(err)) throw err;
    await client?.close().catch(() => {});
    client = undefined;
    const fresh = await getAccessToken({ forceRefresh: true });
    if (!fresh) throw new NotLoggedInError();
    client = await connect(fresh);
    return await fn(client);
  } finally {
    await client?.close().catch(() => {});
  }
}

export async function listRemoteTools(): Promise<Tool[]> {
  return withRemote(async (c) => {
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const page = await c.listTools(cursor ? { cursor } : {});
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  });
}

export async function callRemoteTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  return withRemote((c) => c.callTool({ name, arguments: args }) as Promise<CallToolResult>);
}
