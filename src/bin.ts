#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { revokeSession, startLogin, waitForLogin } from './auth.js';
import { DEFAULT_SCOPES, getBaseUrl, VERSION } from './config.js';
import { parseArgs } from './args.js';
import { callRemoteTool, listRemoteTools } from './remote.js';
import { clearSession, loadSession } from './tokens.js';

const program = new Command();

program
  .name('lola')
  .description(
    'Use LOLA Market from your terminal.\n\n' +
      'Log in once with `lola login`. `lola tools` lists what your account can do;\n' +
      '`lola call <tool> \'{"arg":"value"}\'` runs a tool. AI agents can use the same\n' +
      'session through the `lola-mcp` binary.',
  )
  .version(VERSION);

program
  .command('login')
  .description('Log in through your browser.')
  .option('--scopes <list>', 'Comma-separated scopes to request (default: the standard set).')
  .action(async (opts: { scopes?: string }) => {
    const scopes = opts.scopes ? opts.scopes.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_SCOPES;
    const auth = await startLogin(scopes);
    console.log(`Open this link and approve:\n  ${auth.verification_uri_complete}\n`);
    console.log(`Code: ${auth.user_code}. Waiting for approval…`);
    const session = await waitForLogin(auth);
    console.log(`✓ Logged in${session.owner_email ? ` as ${session.owner_email}` : ''}.`);
  });

program
  .command('logout')
  .description('Remove the local session.')
  .option('--server', 'Also revoke the session on the server.', false)
  .action(async (opts: { server?: boolean }) => {
    if (opts.server) {
      const status = await revokeSession().catch((e: Error) => {
        console.log(`Server revoke failed (${e.message}); removing the local session anyway.`);
        return null;
      });
      if (status !== null) console.log(`Server revoke: HTTP ${status}`);
    }
    console.log((await clearSession()) ? 'Logged out.' : 'Not logged in.');
  });

program
  .command('whoami')
  .description('Show which account this CLI is logged in as.')
  .action(async () => {
    const s = await loadSession();
    if (!s) {
      console.log('Not logged in. Run `lola login`.');
      process.exitCode = 1;
      return;
    }
    console.log(`Logged in${s.owner_email ? ` as ${s.owner_email}` : ''} on ${getBaseUrl()}`);
  });

program
  .command('tools')
  .description('List the tools available to your account.')
  .option('--json', 'Print the full tool definitions as JSON.', false)
  .action(async (opts: { json?: boolean }) => {
    const tools = await listRemoteTools();
    if (opts.json) {
      console.log(JSON.stringify(tools, null, 2));
      return;
    }
    const width = Math.max(...tools.map((t) => t.name.length), 4);
    for (const t of tools) {
      const summary = (t.title ?? t.description ?? '').split('\n')[0];
      console.log(`${t.name.padEnd(width)}  ${summary}`);
    }
  });

program
  .command('call')
  .description('Call a tool. Arguments are a JSON object, inline or from a file.')
  .argument('<tool>', 'Tool name (see `lola tools`).')
  .argument('[json]', 'Arguments as a JSON object, e.g. \'{"q":"drill"}\'.')
  .option('-f, --file <path>', 'Read the arguments from a JSON file.')
  .option('--raw', 'Print the raw MCP result as JSON.', false)
  .action(async (tool: string, json: string | undefined, opts: { file?: string; raw?: boolean }) => {
    const args = parseArgs(opts.file ? await readFile(opts.file, 'utf8') : json);
    const result = await callRemoteTool(tool, args);
    if (opts.raw) console.log(JSON.stringify(result, null, 2));
    else printResult(result);
    if (result.isError) process.exitCode = 1;
  });

function printResult(result: CallToolResult): void {
  for (const part of result.content ?? []) {
    if (part.type === 'text') {
      try {
        console.log(JSON.stringify(JSON.parse(part.text), null, 2));
      } catch {
        console.log(part.text);
      }
    } else {
      console.log(`[${part.type} content]`);
    }
  }
  if (!result.content?.length && result.structuredContent) {
    console.log(JSON.stringify(result.structuredContent, null, 2));
  }
}

program.parseAsync().catch((err: Error) => {
  console.error(`lola: ${err.message}`);
  process.exit(1);
});
