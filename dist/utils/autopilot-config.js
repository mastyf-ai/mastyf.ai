/**
 * Persisted Mastyf AI Autopilot configuration (~/.mastyf-ai/autopilot.json).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { DEFAULT_TENANT_ID, validateTenantId } from '../tenant/resolve-tenant.js';
function configDir() {
    return process.env.MASTYF_AI_AUTOPILOT_CONFIG_DIR || join(homedir(), '.mastyf-ai');
}
export function autopilotConfigPath() {
    return process.env.MASTYF_AI_AUTOPILOT_CONFIG_PATH || join(configDir(), 'autopilot.json');
}
export function lastDigestPath() {
    return process.env.MASTYF_AI_LAST_DIGEST_PATH || join(configDir(), 'last-digest.json');
}
/** @deprecated use autopilotConfigPath() */
export const AUTOPILOT_CONFIG_PATH = join(homedir(), '.mastyf-ai', 'autopilot.json');
export function defaultAutopilotConfig(tenantId = DEFAULT_TENANT_ID) {
    return {
        version: 1,
        enabled: true,
        tenantId: validateTenantId(tenantId),
        initializedAt: new Date().toISOString(),
        reportSchedule: 'daily',
        reportCronHour: 6,
        policyPath: 'default-policy.yaml',
        blockingMode: 'block',
        threatLabOnSemanticTp: true,
        corpusEvalGate: true,
    };
}
export function readAutopilotConfig() {
    const path = autopilotConfigPath();
    if (!existsSync(path))
        return null;
    try {
        const raw = JSON.parse(readFileSync(path, 'utf-8'));
        const base = defaultAutopilotConfig(String(raw.tenantId || DEFAULT_TENANT_ID));
        return {
            ...base,
            ...raw,
            version: 1,
            tenantId: validateTenantId(String(raw.tenantId || base.tenantId)),
        };
    }
    catch {
        return null;
    }
}
export function writeAutopilotConfig(config) {
    const path = autopilotConfigPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}
export function writeLastDigestMeta(meta) {
    const path = lastDigestPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(meta, null, 2) + '\n', 'utf-8');
}
export function readLastDigestMeta() {
    const path = lastDigestPath();
    if (!existsSync(path))
        return null;
    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=autopilot-config.js.map