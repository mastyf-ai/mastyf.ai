/**
 * Polls MCP Mastyf AI Cloud for policy updates and hot-reloads local tenant policy.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { load } from 'js-yaml';
import { parsePolicyConfig, formatPolicyValidationErrors } from '../policy/policy-schema.js';
import { Logger } from '../utils/logger.js';
let pollTimer = null;
let lastVersion = 0;
function controlPlaneUrl() {
    return process.env['MASTYF_AI_CONTROL_PLANE_URL']?.replace(/\/$/, '') || null;
}
function cloudApiKey() {
    return process.env['MASTYF_AI_CLOUD_API_KEY']?.trim()
        || process.env['CONTROL_PLANE_API_KEY']?.trim()
        || null;
}
function tenantPolicyPath(tenantSlug) {
    const base = process.env['MASTYF_AI_POLICY_TEMPLATES_DIR']
        || join(process.cwd(), 'policy-templates');
    return join(base, 'tenants', tenantSlug, 'policy.yaml');
}
export function isPolicySubscriberEnabled() {
    return Boolean(controlPlaneUrl()
        && cloudApiKey()
        && process.env['MASTYF_AI_POLICY_SYNC_ENABLED'] !== 'false');
}
export async function fetchAndApplyCloudPolicy(tenantSlug, policyWatcher) {
    const base = controlPlaneUrl();
    const apiKey = cloudApiKey();
    if (!base || !apiKey)
        return { applied: false, version: lastVersion };
    const res = await fetch(`${base}/api/v1/policy`, {
        headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
        throw new Error(`Policy fetch failed (${res.status})`);
    }
    const versionHeader = res.headers.get('x-policy-version');
    const version = versionHeader ? parseInt(versionHeader, 10) : 0;
    if (version > 0 && version <= lastVersion) {
        return { applied: false, version: lastVersion };
    }
    const yaml = await res.text();
    if (!yaml.trim())
        return { applied: false, version: lastVersion };
    try {
        parsePolicyConfig(load(yaml));
    }
    catch (err) {
        const details = formatPolicyValidationErrors(err);
        throw new Error(`Cloud policy failed schema validation: ${details.map((d) => `${d.path}: ${d.message}`).join('; ')}`);
    }
    const path = tenantPolicyPath(tenantSlug);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, yaml, 'utf-8');
    if (policyWatcher) {
        await policyWatcher.reloadNow?.();
    }
    lastVersion = version > 0 ? version : lastVersion + 1;
    Logger.info(`[policy-subscriber] Applied cloud policy v${lastVersion} → ${path}`);
    return { applied: true, version: lastVersion };
}
export function startPolicySubscriber(tenantSlug, policyWatcher) {
    if (pollTimer || !isPolicySubscriberEnabled())
        return;
    const intervalMs = parseInt(process.env['MASTYF_AI_POLICY_SYNC_INTERVAL_MS'] || '60000', 10);
    const tick = () => {
        void fetchAndApplyCloudPolicy(tenantSlug, policyWatcher).catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            Logger.debug(`[policy-subscriber] sync failed: ${msg}`);
        });
    };
    tick();
    pollTimer = setInterval(tick, intervalMs);
    Logger.info(`[policy-subscriber] Cloud policy sync started (tenant=${tenantSlug})`);
}
export function stopPolicySubscriber() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}
export function resetPolicySubscriberForTests() {
    stopPolicySubscriber();
    lastVersion = 0;
}
//# sourceMappingURL=policy-subscriber.js.map