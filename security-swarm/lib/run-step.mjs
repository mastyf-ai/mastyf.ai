/**
 * Hardened spawnSync wrapper — per-step timeouts, maxBuffer, stderr redaction.
 */
import { spawnSync } from 'node:child_process';

export const DEFAULT_MAX_BUFFER = 2 * 1024 * 1024;

/** Step label → default timeout (ms). */
export const STEP_TIMEOUT_MS = {
  'scout-audit': 60_000,
  'pnpm-build': 300_000,
  'vitest-policy-proxy-utils': 300_000,
  'corpus-eval': 120_000,
  'adversarial-harness-full': 600_000,
  'attack-learning-sim': 120_000,
  'setup-python-venv': 120_000,
  'harness-node-tests': 300_000,
  'harness-parity': 900_000,
  'security-swarm-gates': 900_000,
  'evasion-generate': 120_000,
  default: 600_000,
};

function resolveStepTimeoutMs(label, stepKey, explicitMs) {
  if (explicitMs != null && Number.isFinite(explicitMs) && explicitMs > 0) return explicitMs;
  const base =
    STEP_TIMEOUT_MS[label] ??
    STEP_TIMEOUT_MS[stepKey] ??
    STEP_TIMEOUT_MS.default;
  const mult = parseFloat(process.env.MASTYF_AI_SWARM_TIMEOUT_MULTIPLIER || '1');
  if (!Number.isFinite(mult) || mult <= 0) return base;
  return Math.round(base * mult);
}

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /api[_-]?key[=:]\s*['"]?[^\s'"]+/gi,
  /password[=:]\s*['"]?[^\s'"]+/gi,
  /sk-[A-Za-z0-9]{20,}/g,
  /gcp_[A-Za-z0-9]{16,}/g,
];

export function sanitizeSpawnOutput(text) {
  if (!text) return '';
  let out = String(text);
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, '[REDACTED]');
  }
  if (out.length > 512) {
    return `${out.slice(0, 512)}…[truncated]`;
  }
  return out;
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {object} opts
 * @returns {import('node:child_process').SpawnSyncReturns<string|Buffer>}
 */
/**
 * On Windows, pnpm/npm/npx are .cmd shims, which Node only starts through a shell (spawning
 * them directly fails at once, so every swarm step "failed in 0.0s"). Step commands and
 * arguments are fixed in this repo, never user input; arguments with spaces are quoted.
 */
export function windowsSpawnPlan(cmd, args, platform = process.platform, env = process.env) {
  // Under `pnpm run`, npm_execpath is pnpm's own entry script: run it with this Node. No shell,
  // no PATH lookup, works the same everywhere (including Corepack-only installs).
  const execpath = env.npm_execpath || '';
  if (cmd === 'pnpm' && /pnpm(\.c?js)?$/i.test(execpath) && /\.c?js$/i.test(execpath)) {
    return { cmd: process.execPath, args: [execpath, ...args], shell: false };
  }
  const direct = platform !== 'win32' || cmd === process.execPath || /^node(\.exe)?$/i.test(cmd) || /\.(exe|com)$/i.test(cmd);
  if (direct) return { cmd, args, shell: false };
  const quote = (a) => (/[\s"&|<>^()]/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : String(a));
  // One command line (not cmd + args) so Node does not warn about unescaped shell args.
  return { cmd: [quote(cmd), ...args.map(quote)].join(' '), args: [], shell: true };
}

/** spawnSync with the same Windows/pnpm handling as runStep, for agents that call pnpm directly. */
export function spawnTool(cmd, args, options = {}) {
  const plan = windowsSpawnPlan(cmd, args);
  return spawnSync(plan.cmd, plan.args, { ...options, shell: plan.shell });
}

export function runStep(cmd, args, opts = {}) {
  const label = opts.label ?? [cmd, ...args].join(' ');
  const timeoutMs = resolveStepTimeoutMs(label, opts.stepKey, opts.timeoutMs);
  const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const live = opts.live === true;

  const plan = windowsSpawnPlan(cmd, args);
  const r = spawnSync(plan.cmd, plan.args, {
    shell: plan.shell,
    cwd: opts.cwd,
    encoding: live ? undefined : 'utf-8',
    timeout: timeoutMs,
    maxBuffer,
    env: {
      ...process.env,
      NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=4096',
      ...opts.env,
    },
    stdio: live ? 'inherit' : ['pipe', 'pipe', 'pipe'],
  });

  if (r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM' || r.signal === 'SIGKILL') {
    return { ...r, status: r.status ?? 124, timedOut: true };
  }
  return r;
}

export function formatStepOutput(r, live) {
  if (live) return { stdout: '', stderr: '' };
  return {
    stdout: sanitizeSpawnOutput(String(r.stdout || '').slice(0, 4000)),
    stderr: sanitizeSpawnOutput(String(r.stderr || '').slice(0, 1500)),
  };
}
