/**
 * mastyf-check: Mastyf's free checks for an agent's tool calls and results, on this machine.
 *
 *   mastyf-check serve [--port 4100] [--host 127.0.0.1] [--policy file] [--mode block|observe] [--log json|text]
 *   mastyf-check proxy [--policy file] [--mode block|observe] -- <command> [args...]
 *   mastyf-check test [--policy file] [--mode block|observe] <tool> '<json arguments>'
 */
import { homedir } from 'node:os';
import type { Readable, Writable } from 'node:stream';
import { CheckEngine } from './engine';
import { startServer, VERSION } from './server';
import { startStdioProxy } from './stdio-proxy';
import { ensureToken } from './token';

export interface Io {
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  env: Record<string, string | undefined>;
}

export interface RunResult {
  code: number;
  close?: () => Promise<void>;
  /** For `proxy`: settles with the exit code to use once the server has stopped. */
  exited?: Promise<number>;
}

const HELP = `mastyf-check ${VERSION}: Mastyf's free checks for AI agents' tool calls, on this machine.

Commands:
  serve   Start the check API on 127.0.0.1 (default port 4100).
          Options: --port <n>  --host <address>  --policy <file>  --mode block|observe  --log json|text
  proxy   Put the checks in front of one MCP server on stdio:
          mastyf-check proxy [--policy <file>] [--mode block|observe] -- <command> [args...]
  test    Check one call and print the verdict (exit 2 when blocked):
          mastyf-check test <tool> '<json arguments>'

The token for the API is in ~/.mastyf/check/token (Windows: %APPDATA%\\Mastyf\\check\\token),
or set MASTYF_CHECK_TOKEN. Paid protection (Protocol X and more) is in the Mastyf Shield app.
`;

interface Parsed {
  command?: string;
  flags: Record<string, string>;
  rest: string[];
  child: string[];
}

function parse(argv: string[]): Parsed {
  const out: Parsed = { flags: {}, rest: [], child: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      out.child = argv.slice(i + 1);
      break;
    }
    if (a === '--help' || a === '-h') out.flags['help'] = 'true';
    else if (a.startsWith('--')) out.flags[a.slice(2)] = argv[++i] ?? '';
    else if (!out.command) out.command = a;
    else out.rest.push(a);
  }
  return out;
}

const say = (stream: Writable, text: string) => stream.write(text.endsWith('\n') ? text : `${text}\n`);

function mode(flags: Record<string, string>): 'block' | 'observe' {
  const m = flags['mode'] ?? 'block';
  if (m !== 'block' && m !== 'observe') throw new Error(`--mode must be block or observe, not "${m}"`);
  return m;
}

export async function run(argv: string[], io: Io): Promise<RunResult> {
  const p = parse(argv);
  if (p.flags['help'] || !p.command) {
    say(io.stdout, HELP);
    return { code: p.command || p.flags['help'] ? 0 : 1 };
  }
  try {
    switch (p.command) {
      case 'test': {
        const [tool, json] = p.rest;
        if (!tool) throw new Error('usage: mastyf-check test <tool> \'<json arguments>\'');
        let args: Record<string, unknown>;
        try {
          args = json ? JSON.parse(json) : {};
        } catch {
          throw new Error('the arguments are not valid JSON');
        }
        const engine = await CheckEngine.create({ policyPath: p.flags['policy'], mode: mode(p.flags) });
        const v = await engine.checkCall({ tool, arguments: args });
        say(io.stdout, JSON.stringify(v, null, 2));
        return { code: v.decision === 'block' ? 2 : 0 };
      }

      case 'serve': {
        const host = p.flags['host'] ?? io.env['MASTYF_CHECK_HOST'] ?? '127.0.0.1';
        // Beyond this machine (e.g. in a container), a token file nobody else can read doesn't exist:
        // the token must be set on purpose.
        if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !io.env['MASTYF_CHECK_TOKEN']) {
          throw new Error(`listening on ${host} needs MASTYF_CHECK_TOKEN set (32 characters or more); 127.0.0.1 doesn't`);
        }
        const engine = await CheckEngine.create({ policyPath: p.flags['policy'], mode: mode(p.flags) });
        const token = ensureToken({ env: io.env, home: homedir(), platform: process.platform });
        const port = Number(p.flags['port'] ?? io.env['MASTYF_CHECK_PORT'] ?? 4100);
        if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`--port must be a port number, not "${p.flags['port']}"`);
        const text = p.flags['log'] === 'text';
        const log = (line: string) => say(io.stderr, text ? Object.entries(JSON.parse(line)).map(([k, v]) => `${k}=${v}`).join(' ') : line);
        let server;
        try {
          server = await startServer(engine, { host, port, token, log });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') throw new Error(`port ${port} is in use (is mastyf-check already running?)`);
          throw err;
        }
        say(io.stderr, `mastyf-check ${VERSION} listening on ${server.url} (free tier, ${engine.ruleCount()} rules)`);
        return { code: 0, close: server.close };
      }

      case 'proxy': {
        if (!p.child.length) throw new Error('usage: mastyf-check proxy -- <command> [args...]');
        const engine = await CheckEngine.create({ policyPath: p.flags['policy'], mode: mode(p.flags) });
        const [command, ...args] = p.child;
        const proxy = startStdioProxy(engine, {
          command,
          args,
          input: io.stdin,
          output: io.stdout,
          log: (line) => say(io.stderr, line),
          server: p.flags['server'],
        });
        return { code: 0, close: proxy.close, exited: proxy.exited };
      }

      default:
        say(io.stderr, `unknown command "${p.command}"\n\n${HELP}`);
        return { code: 1 };
    }
  } catch (err) {
    say(io.stderr, `mastyf-check: ${err instanceof Error ? err.message : String(err)}`);
    return { code: 1 };
  }
}
