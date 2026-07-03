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
export function runStep(cmd, args, opts = {}) {
  const label = opts.label ?? [cmd, ...args].join(' ');
  const timeoutMs = resolveStepTimeoutMs(label, opts.stepKey, opts.timeoutMs);
  const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const live = opts.live === true;

  const r = spawnSync(cmd, args, {
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
