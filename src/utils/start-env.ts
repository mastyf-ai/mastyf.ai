/**
 * Default environment for `mastyf-ai start` (local dashboard + proxy).
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** LLM + async semantic audit + AI learning defaults for proxy/dashboard processes. */
export function applyProxyRuntimeDefaults(): void {
  const defaults: Record<string, string> = {
    MASTYF_AI_LLM_ENABLED: 'true',
    MASTYF_AI_SEMANTIC_ASYNC: 'true',
    MASTYF_AI_AI_ENABLED: 'true',
  };
  for (const [key, val] of Object.entries(defaults)) {
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

export function applyStartEnv(overrides?: Record<string, string>): void {
  applyProxyRuntimeDefaults();
  const home = homedir();
  const defaults: Record<string, string> = {
    MASTYF_AI_DB_PATH: join(home, '.mastyf-ai', 'history.db'),
    DASHBOARD_ENABLED: 'true',
    DASHBOARD_AUTH_DISABLED: 'true',
    MASTYF_AI_CI_BYPASS_LICENSE: 'true',
    MASTYF_AI_WS_ENABLED: 'true',
    MASTYF_AI_LLM_ENABLED: 'true',
    MASTYF_AI_SEMANTIC_ASYNC: 'true',
    MASTYF_AI_AI_ENABLED: 'true',
    METRICS_ENABLED: 'true',
    DASHBOARD_PORT: '4000',
    METRICS_PORT: '9090',
    OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
    MASTYF_AI_BLOCKING_MODE: 'block',
  };

  for (const [key, val] of Object.entries(defaults)) {
    if (process.env[key] === undefined) process.env[key] = val;
  }
  if (overrides) {
    for (const [key, val] of Object.entries(overrides)) {
      process.env[key] = val;
    }
  }
}

export function resolveStartPolicy(installRoot: string): string {
  const audit = join(installRoot, 'policy-audit.yaml');
  const def = join(installRoot, 'default-policy.yaml');
  if (existsSync(audit)) return audit;
  if (existsSync(def)) return def;
  return 'policy-audit.yaml';
}

export function isDashboardSpaBuilt(installRoot: string): boolean {
  return existsSync(join(installRoot, 'deploy', 'dashboard-spa', 'out', 'index.html'));
}
