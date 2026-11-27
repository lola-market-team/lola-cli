#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { getAccessToken, startLogin } from './auth.js';
import { DEFAULT_SCOPES, VERSION } from './config.js';
import { callRemoteTool, listRemoteTools, NotLoggedInError } from './remote.js';
import { loadSession } from './tokens.js';

/**
 * lola-mcp: a stdio MCP server that forwards to the hosted LOLA MCP server
 * using the session `lola login` stored. The tools come from the server, so
 * this bridge always offers exactly what the logged-in account can use.
 *
 * Two local tools work without a session: `lola_status` and `lola_login`.
 */
const LOCAL_TOOLS: Tool[] = [
  {
    name: 'lola_status',
    description: 'Check whether this LOLA connection is logged in. Works before login.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'lola_login',
    description:
      'Start a LOLA login. Returns a link for the user to open and approve. ' +
      'Once they approve, the LOLA tools become available.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const text = (s: string, isError = false) => ({ content: [{ type: 'text' as const, text: s }], isError });

const server = new Server(
  { name: 'lola', version: VERSION },
  { capabilities: { tools: { listChanged: true } } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  try {
    return { tools: [...LOCAL_TOOLS, ...(await listRemoteTools())] };
  } catch (err) {
    if (!(err instanceof NotLoggedInError)) process.stderr.write(`lola-mcp: ${(err as Error).message}\n`);
    return { tools: LOCAL_TOOLS };
  }
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name } = req.params;
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;

  if (name === 'lola_status') {
    const s = await loadSession();
    return text(JSON.stringify({ logged_in: !!s, ...(s?.owner_email ? { account: s.owner_email } : {}) }));
  }
  if (name === 'lola_login') {
    const auth = await startLogin(DEFAULT_SCOPES);
    watchForApproval(auth.interval, auth.expires_in);
    return text(
      `Ask the user to open this link and approve:\n${auth.verification_uri_complete}\n\n` +
        'After they approve, call lola_status to confirm.',
    );
  }

  try {
    return await callRemoteTool(name, args);
  } catch (err) {
    return text((err as Error).message, true);
  }
});

/** After an agent-started login, tell the host when the tool list changes. */
function watchForApproval(intervalSeconds: number, expiresInSeconds: number): void {
  const deadline = Date.now() + expiresInSeconds * 1000;
  const timer = setInterval(async () => {
    if (Date.now() > deadline) return clearInterval(timer);
    const token = await getAccessToken().catch(() => null);
    if (token) {
      clearInterval(timer);
      await server.sendToolListChanged().catch(() => {});
    }
  }, Math.max(2, intervalSeconds) * 1000);
  timer.unref();
}

server.connect(new StdioServerTransport()).catch((err) => {
  process.stderr.write(`lola-mcp: fatal: ${err?.message ?? err}\n`);
  process.exit(1);
});
