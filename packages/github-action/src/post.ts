/**
 * The Action's post step (end of the job, even when a step failed): lists what the checks blocked
 * in the job summary, sets the counts, fails the job if asked to, and stops the checks.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { claudeHooksProblem, removeOurHooks } from './claude-settings.js';
import { pidAlive, stopEngine, verifyHealth } from './engine.js';
import { appendSummary, fail, getState, setOutput, warning } from './runner.js';
import { counts, renderSummary, type Block } from './summary.js';

type Env = Record<string, string | undefined>;
type Print = (line: string) => void;

const KEPT = 200; // how many entries the service keeps

interface Totals {
  blocked: number;
  wouldBlock: number;
  redacted: number;
}

/** Why Claude Code's checks can't be trusted to have been on for the whole job, or null. */
function claudeProblem(env: Env): string | null {
  const command = getState('claudeCommand', env);
  if (!command) return null; // claude-code wasn't on
  const hook = getState('claudeHook', env);
  const sha = getState('claudeHookSha', env);
  const now = hook && existsSync(hook) ? createHash('sha256').update(readFileSync(hook)).digest('hex') : '';
  if (sha && now !== sha) return 'the hook program was changed';
  return claudeHooksProblem(home(env), env['GITHUB_WORKSPACE'] || process.cwd(), command);
}

function home(env: Env): string {
  return env['HOME'] || env['USERPROFILE'] || homedir();
}

async function fetchBlocks(url: string, token: string): Promise<{ blocks: Block[]; totals: Totals | null } | null> {
  try {
    await verifyHealth(url, token); // the service this Action started, nothing else on that port
    const res = await fetch(`${url}/v1/blocks?limit=${KEPT}`, {
      headers: { authorization: `Bearer ${token}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status !== 200) return null;
    const data = (await res.json()) as { blocks?: unknown };
    if (!Array.isArray(data.blocks)) return null;
    const blocks = data.blocks.filter((b): b is Block => !!b && typeof b === 'object' && typeof (b as Block).outcome === 'string');
    const t = (data as { totals?: Partial<Totals> }).totals;
    const totals = t && [t.blocked, t.wouldBlock, t.redacted].every((n) => Number.isInteger(n)) ? (t as Totals) : null;
    return { blocks, totals };
  } catch {
    return null;
  }
}

export async function run(env: Env = process.env, opts: { print?: Print } = {}): Promise<void> {
  const print = opts.print ?? ((line: string) => process.stdout.write(`${line}\n`));
  const startedOk = getState('started', env) === 'true';
  const showReasons = getState('showReasons', env) === 'true';
  const failOnBlock = getState('failOnBlock', env) === 'true';
  const pid = Number(getState('pid', env) || 0);
  const url = getState('url', env);
  const log = getState('log', env);

  // Only the engine this Action started counts: a later step has the token and could start its
  // own on the same port after stopping ours.
  const ours = startedOk && !!url && pidAlive(pid);
  const fetched = ours ? await fetchBlocks(url, getState('token', env)) : null;
  const blocks = fetched?.blocks ?? null;
  // The service's totals are never capped: a flood can't push a block out of the count.
  const totals = fetched?.totals ?? null;
  const n = totals ? { blocked: totals.blocked + totals.wouldBlock, redacted: totals.redacted } : blocks ? counts(blocks) : null;
  const observed = totals ? totals.blocked === 0 && totals.wouldBlock > 0 : !!blocks && n!.blocked > 0 && blocks.every((b) => b.outcome !== 'blocked');
  const tampered = claudeProblem(env);
  // Decide first, so a failure writing the summary can never skip it.
  const failure =
    failOnBlock && n && n.blocked > 0
      ? observed
        ? `Mastyf: ${n.blocked} tool call(s) would have been blocked (observe mode); see the job summary.`
        : `Mastyf blocked ${n.blocked} tool call(s); see the job summary.`
      : failOnBlock && startedOk && !blocks
        ? "Mastyf couldn't confirm what was blocked in this job (the checks weren't reachable at the end); failing because fail-on-block is set."
        : failOnBlock && tampered
          ? `Mastyf: Claude Code's hooks were switched off or changed during the job (${tampered}), so its tool calls may not all have been checked; failing because fail-on-block is set.`
          : null;
  try {
    if (tampered) {
      appendSummary(`> **Warning:** Claude Code's hooks were switched off or changed during the job (${tampered}); its tool calls may not all have been checked.
`, env);
      if (!failOnBlock) warning(`Mastyf: Claude Code's hooks were switched off or changed during the job (${tampered}).`, print);
    }
    appendSummary(renderSummary(blocks, { showReasons, capped: (blocks?.length ?? 0) >= KEPT, serviceStarted: startedOk }), env);
    if (n) {
      setOutput('blocked-count', String(n.blocked), env);
      setOutput('redacted-count', String(n.redacted), env);
    } else if (startedOk && !failOnBlock) {
      warning("Mastyf: the checks weren't reachable at the end of the job; the summary has no list.", print);
    }
  } catch (err) {
    warning(`Mastyf: couldn't write the summary (${(err as Error).message})`, print);
  } finally {
    if (failure) fail(failure, print);
    if (pid) await stopEngine(pid);
    const command = getState('claudeCommand', env);
    if (command) {
      try {
        removeOurHooks(home(env), command); // self-hosted runners keep ~/.claude for later jobs
      } catch {
        /* nothing to clean */
      }
    }
    if (log) rmSync(log, { force: true });
  }
}

if (process.env['GITHUB_ACTIONS'] === 'true' && /post\.c?js$/.test(process.argv[1] ?? '')) {
  run().catch((err) => warning(`Mastyf: ${(err as Error).message}`));
}
