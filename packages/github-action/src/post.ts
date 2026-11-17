/**
 * The Action's post step (end of the job, even when a step failed): lists what the checks blocked
 * in the job summary, sets the counts, fails the job if asked to, and stops the checks.
 */
import { rmSync } from 'node:fs';
import { pidAlive, stopEngine, verifyHealth } from './engine.js';
import { appendSummary, fail, getState, setOutput, warning } from './runner.js';
import { counts, renderSummary, type Block } from './summary.js';

type Env = Record<string, string | undefined>;
type Print = (line: string) => void;

const KEPT = 200; // how many entries the service keeps

async function fetchBlocks(url: string, token: string): Promise<Block[] | null> {
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
    return data.blocks.filter((b): b is Block => !!b && typeof b === 'object' && typeof (b as Block).outcome === 'string');
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
  const blocks = ours ? await fetchBlocks(url, getState('token', env)) : null;
  const n = blocks ? counts(blocks) : null;
  const observed = !!blocks && n!.blocked > 0 && blocks.every((b) => b.outcome !== 'blocked');
  // Decide first, so a failure writing the summary can never skip it.
  const failure =
    failOnBlock && n && n.blocked > 0
      ? observed
        ? `Mastyf: ${n.blocked} tool call(s) would have been blocked (observe mode); see the job summary.`
        : `Mastyf blocked ${n.blocked} tool call(s); see the job summary.`
      : failOnBlock && startedOk && !blocks
        ? "Mastyf couldn't confirm what was blocked in this job (the checks weren't reachable at the end); failing because fail-on-block is set."
        : null;
  try {
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
    if (log) rmSync(log, { force: true });
  }
}

if (process.env['GITHUB_ACTIONS'] === 'true' && /post\.c?js$/.test(process.argv[1] ?? '')) {
  run().catch((err) => warning(`Mastyf: ${(err as Error).message}`));
}
