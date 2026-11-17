/**
 * Claude Code hook (PreToolUse and PostToolUse): sends each tool call and result to this job's
 * Mastyf checks. Usage, as written into the settings by the Action:
 *   node claude-hook.cjs <config.json>
 * Fails closed: if the call can't be checked, it is blocked (exit 2).
 * Never prints the matched text, the tool's data or the token.
 */
import { readFileSync } from 'node:fs';

const CANT_CHECK = "Mastyf couldn't check this tool call, so it was blocked.";

interface Verdict {
  decision: 'allow' | 'block' | 'redact';
  layer?: string;
  rule?: string;
  result?: unknown;
}

function message(v: Verdict): string {
  const parts = [v.layer, v.rule].filter(Boolean).join(': ');
  return parts ? `Blocked by Mastyf (${parts}).` : 'Blocked by Mastyf.';
}

/** The same shape with its text taken out: the first string becomes `msg`, other strings "". */
export function replaceText(value: unknown, msg: string): unknown {
  let placed = false;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (placed) return '';
      placed = true;
      return msg;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  if (value === null || value === undefined) return msg;
  return walk(value);
}

async function ask(config: { url: string; token: string }, path: string, body: unknown): Promise<Verdict> {
  const res = await fetch(`${config.url}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status !== 200) throw new Error(`answered ${res.status}`);
  const v = (await res.json()) as Verdict;
  if (v.decision !== 'allow' && v.decision !== 'block' && v.decision !== 'redact') throw new Error('not a verdict');
  return v;
}

export async function runHook(stdin: string, configPath: string): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const input = JSON.parse(stdin) as Record<string, unknown>;
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { url: string; token: string };
    const event = input['hook_event_name'];
    const tool = String(input['tool_name'] ?? '');
    const rawArgs = input['tool_input'];
    const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs : { input: rawArgs ?? null };
    const where = { server: 'claude-code', session: String(input['session_id'] ?? '') };

    if (event === 'PreToolUse') {
      const v = await ask(config, '/v1/check/call', { tool, arguments: args, ...where });
      if (v.decision !== 'block') return { code: 0, stdout: '', stderr: '' };
      const out = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: message(v) } };
      return { code: 0, stdout: JSON.stringify(out), stderr: '' };
    }
    if (event === 'PostToolUse') {
      const response = input['tool_response'];
      const v = await ask(config, '/v1/check/result', { tool, result: response ?? null, arguments: args, ...where });
      if (v.decision === 'block') {
        const msg = message(v);
        const out = { decision: 'block', reason: msg, hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: replaceText(response, msg) } };
        return { code: 0, stdout: JSON.stringify(out), stderr: '' };
      }
      if (v.decision === 'redact') {
        const out = { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: v.result } };
        return { code: 0, stdout: JSON.stringify(out), stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' }; // other events: nothing to check
  } catch {
    return { code: 2, stdout: '', stderr: CANT_CHECK };
  }
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const r = await runHook(Buffer.concat(chunks).toString('utf8'), process.argv[2] ?? '');
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
