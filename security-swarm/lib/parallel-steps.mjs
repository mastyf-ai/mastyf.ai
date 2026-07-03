/**
 * H15 — Run independent swarm steps in parallel (FAST mode scale).
 */
import { runStep, formatStepOutput } from './run-step.mjs';

export function runParallelSwarmSteps(steps, { cwd, live, env = {} }) {
  return Promise.all(
    steps.map(async (spec) => {
      const label = spec.label ?? [spec.cmd, ...(spec.args || [])].join(' ');
      const started = Date.now();
      const r = runStep(spec.cmd, spec.args, {
        cwd: cwd ?? spec.cwd,
        label,
        stepKey: label,
        timeoutMs: spec.timeoutMs,
        live,
        env: { ...process.env, ...env, ...spec.env },
      });
      const elapsedSec = parseFloat(((Date.now() - started) / 1000).toFixed(1));
      const timedOut = !!r.timedOut;
      const ok = r.status === 0 && !timedOut;
      const { stdout, stderr } = formatStepOutput(r, live);
      return {
        label,
        ok,
        status: timedOut ? 124 : (r.status ?? 1),
        timedOut,
        elapsedSec,
        stdout,
        stderr,
      };
    }),
  );
}
