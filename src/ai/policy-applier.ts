import { readFileSync, writeFileSync } from 'fs';
import { load, dump } from 'js-yaml';
import { PolicyRule, PolicyConfig } from '../policy/policy-types.js';
import { parsePolicyConfig } from '../policy/policy-schema.js';
import { PolicyWatcher } from '../policy/policy-watcher.js';
import { Logger } from '../utils/logger.js';
import { resolvePolicyPath } from '../utils/tui-sources.js';

function rulesEqual(a: PolicyRule, b: PolicyRule): boolean {
  if (a.name === b.name) return true;
  if (JSON.stringify(a.tools) === JSON.stringify(b.tools)
    && JSON.stringify(a.argPatterns) === JSON.stringify(b.argPatterns)) {
    return true;
  }
  return false;
}

/**
 * Merge an accepted suggestion into live policy YAML and hot-reload via PolicyWatcher.
 */
export function applySuggestionToPolicy(
  rule: PolicyRule,
  policyPath?: string | null,
  policyWatcher?: PolicyWatcher | null,
): { applied: boolean; policyPath: string | null; reason?: string } {
  const path = policyPath || resolvePolicyPath();
  if (!path) {
    return { applied: false, policyPath: null, reason: 'No policy file (set GUARDIAN_POLICY_PATH)' };
  }

  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = load(raw) as PolicyConfig;
    const config = parsePolicyConfig(parsed);
    const existing = config.policy.rules;
    if (existing.some((r) => rulesEqual(r, rule))) {
      Logger.info(`[policy-applier] Rule "${rule.name}" already present — skipping`);
      return { applied: false, policyPath: path, reason: 'duplicate' };
    }

    config.policy.rules.push(rule);
    const out = dump({
      version: config.version,
      policy: config.policy,
    }, { lineWidth: 120, noRefs: true });
    writeFileSync(path, out, 'utf-8');
    Logger.info(`[policy-applier] Appended rule "${rule.name}" → ${path}`);

    if (policyWatcher) {
      // chokidar reloads on write; touch is unnecessary
    }

    return { applied: true, policyPath: path };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    Logger.error(`[policy-applier] Failed to apply rule: ${msg}`);
    return { applied: false, policyPath: path, reason: msg };
  }
}

/**
 * Remove an existing policy rule by name and write updated YAML.
 */
/** Look up a rule by name in the policy YAML file. */
export function findPolicyRuleByName(
  ruleName: string,
  policyPath?: string | null,
): PolicyRule | null {
  const path = policyPath || resolvePolicyPath();
  if (!path || !ruleName.trim()) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = load(raw) as PolicyConfig;
    const config = parsePolicyConfig(parsed);
    return config.policy.rules.find((r) => r.name === ruleName) ?? null;
  } catch {
    return null;
  }
}

/**
 * Remove an existing policy rule by name and write updated YAML.
 */
export function removeSuggestionRuleFromPolicy(
  ruleName: string,
  policyPath?: string | null,
  policyWatcher?: PolicyWatcher | null,
): { removed: boolean; policyPath: string | null; reason?: string } {
  const path = policyPath || resolvePolicyPath();
  if (!path) {
    return { removed: false, policyPath: null, reason: 'No policy file (set GUARDIAN_POLICY_PATH)' };
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = load(raw) as PolicyConfig;
    const config = parsePolicyConfig(parsed);
    const before = config.policy.rules.length;
    config.policy.rules = config.policy.rules.filter((r) => r.name !== ruleName);
    if (config.policy.rules.length === before) {
      return { removed: false, policyPath: path, reason: 'not_found' };
    }
    const out = dump({
      version: config.version,
      policy: config.policy,
    }, { lineWidth: 120, noRefs: true });
    writeFileSync(path, out, 'utf-8');
    if (policyWatcher) {
      // chokidar reloads on write; touch is unnecessary
    }
    return { removed: true, policyPath: path };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    Logger.error(`[policy-applier] Failed to remove rule "${ruleName}": ${msg}`);
    return { removed: false, policyPath: path, reason: msg };
  }
}
