/**
 * Claude Code hook (PreToolUse and PostToolUse): sends each tool call and result to this job's
 * Mastyf checks. Usage, as written into the settings by the Action:
 *   node claude-hook.cjs <checks URL on 127.0.0.1> <token>
 * Fails closed: a call that can't be checked is blocked (exit 2); a result that can't be checked
 * is replaced before Claude reads it. Never prints the matched text, the tool's data or the token.
 */

const CANT_CHECK = "Mastyf couldn't check this tool call, so it was blocked.";

interface Verdict {
  decision: 'allow' | 'block' | 'redact';
  layer?: string;
  rule?: string;
  result?: unknown;
}

type Out = { code: number; stdout: string; stderr: string };

function message(v: Verdict): string {
  const parts = [v.layer, v.rule].filter(Boolean).join(': ');
  return parts ? `Blocked by Mastyf (${parts}).` : 'Blocked by Mastyf.';
}

/** Short enum-like fields Claude Code checks the output shape by: kept, if they look like one. */
const KEEP = new Set(['type', 'mode', 'kind', 'status']);
const ENUM = /^[a-z][a-z0-9_-]{0,31}$/i;

/** Every string that isn't `msg` or a short identifier becomes "": nothing of the response's text survives. */
function scrub(value: unknown, msg: string): unknown {
  if (typeof value === 'string') return value === msg || ENUM.test(value) ? value : '';
  if (Array.isArray(value)) return value.map((v) => scrub(v, msg));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, msg)]));
  return value;
}

/** The same shape with its text taken out: the first string becomes `msg`, other strings "". */
export function replaceText(value: unknown, msg: string): unknown {
  let placed = false;
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === 'string') {
      if (key !== undefined && KEEP.has(key) && ENUM.test(v)) return v;
      if (placed) return '';
      placed = true;
      return msg;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  if (value === null || value === undefined) return msg;
  return walk(value);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * What Claude reads instead of a blocked result. Claude Code only takes a replacement for a
 * built-in tool in that tool's own output format, so the known ones are replaced field by field;
 * an MCP tool's output is anything its server sent (keys included), so it is replaced whole.
 */
export function replaceFor(tool: string, response: unknown, msg: string): unknown {
  if (tool.startsWith('mcp__')) return msg;
  return scrub(shaped(tool, response, msg), msg);
}

function shaped(tool: string, response: unknown, msg: string): unknown {
  if (isObj(response)) {
    if (tool === 'Read' && isObj(response['file']) && typeof response['file']['content'] === 'string') {
      return { ...response, file: { ...response['file'], content: msg } };
    }
    if (tool === 'Bash' && ('stdout' in response || 'stderr' in response)) return { ...response, stdout: msg, stderr: '' };
    if (tool === 'WebFetch' && typeof response['result'] === 'string') return { ...response, result: msg };
    if (tool === 'Grep' && ('content' in response || 'filenames' in response)) {
      return { ...response, ...('content' in response ? { content: msg } : {}), ...('filenames' in response ? { filenames: [] } : {}) };
    }
  }
  return replaceText(response, msg);
}

/** Claude Code's own settings and this hook: a misled Claude must not switch the checks off. */
// Best effort only (shell text can always be written another way): the real protections are the
// refused settings changes and the end-of-job check. `.cl` + a glob character catches `.cl*de`.
const PROTECTED = /\.claude|\.cl[*?[]|claude-hook/i;

function touchesProtected(tool: string, args: Record<string, unknown>): boolean {
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    return PROTECTED.test(String(args['file_path'] ?? args['notebook_path'] ?? ''));
  }
  if (tool === 'Bash' || tool === 'PowerShell') return PROTECTED.test(String(args['command'] ?? ''));
  return false;
}

function blockResult(tool: string, response: unknown, msg: string): Out {
  const out = { decision: 'block', reason: msg, hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: replaceFor(tool, response, msg) } };
  return { code: 0, stdout: JSON.stringify(out), stderr: '' };
}

/** Only this machine's checks: nothing is ever sent off the runner. */
function loopback(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

async function ask(url: string, token: string, path: string, body: unknown): Promise<Verdict> {
  if (!loopback(url) || !token) throw new Error('bad target');
  const res = await fetch(`${url.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status !== 200) throw new Error(`answered ${res.status}`);
  const v = (await res.json()) as Verdict;
  if (v.decision !== 'allow' && v.decision !== 'block' && v.decision !== 'redact') throw new Error('not a verdict');
  return v;
}

export async function runHook(stdin: string, url: string, token: string): Promise<Out> {
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(stdin) as Record<string, unknown>;
    if (!input || typeof input !== 'object') throw new Error('not an object');
  } catch {
    return { code: 2, stdout: '', stderr: CANT_CHECK };
  }
  const event = input['hook_event_name'];
  const tool = String(input['tool_name'] ?? '');
  const rawArgs = input['tool_input'];
  const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs : { input: rawArgs ?? null };
  const where = { server: 'claude-code', session: String(input['session_id'] ?? '') };

  if (event === 'PreToolUse') {
    if (touchesProtected(tool, args as Record<string, unknown>)) {
      const reason = "Blocked by Mastyf (claude-code: protected-settings). Claude Code's settings and Mastyf's hook can't be changed during the run.";
      const out = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
      return { code: 0, stdout: JSON.stringify(out), stderr: '' };
    }
    try {
      const v = await ask(url, token, '/v1/check/call', { tool, arguments: args, ...where });
      if (v.decision !== 'block') return { code: 0, stdout: '', stderr: '' };
      const out = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: message(v) } };
      return { code: 0, stdout: JSON.stringify(out), stderr: '' };
    } catch {
      return { code: 2, stdout: '', stderr: CANT_CHECK };
    }
  }

  if (event === 'PostToolUse') {
    const response = input['tool_response'];
    try {
      const v = await ask(url, token, '/v1/check/result', { tool, result: response ?? null, arguments: args, ...where });
      if (v.decision === 'block') return blockResult(tool, response, message(v));
      if (v.decision === 'redact' && v.result === undefined) return blockResult(tool, response, message(v)); // no cleaned copy: never the original
      if (v.decision === 'redact') {
        const out = { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: v.result } };
        return { code: 0, stdout: JSON.stringify(out), stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    } catch {
      // The tool already ran: blocking now wouldn't take the result back, so replace it.
      return blockResult(tool, response, CANT_CHECK);
    }
  }

  return { code: 0, stdout: '', stderr: '' }; // other events: nothing to check
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const r = await runHook(Buffer.concat(chunks).toString('utf8'), process.argv[2] ?? '', process.argv[3] ?? '');
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exitCode = r.code;
}

if (/claude-hook\.c?js$/.test(process.argv[1] ?? '')) {
  main().catch(() => {
    process.stderr.write(CANT_CHECK);
    process.exitCode = 2;
  });
}
