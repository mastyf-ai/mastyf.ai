/**
 * Shadow / dry-run policy evaluation on live traffic.
 * MASTYF_AI_POLICY_SHADOW_PATH — YAML policy evaluated in parallel; logs only.
 */
import { readFileSync, existsSync } from 'fs';
import { load } from 'js-yaml';
import { PolicyEngine } from './policy-engine.js';
import { parsePolicyConfig } from './policy-schema.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import { Logger } from '../utils/logger.js';
let shadowEngine;
export function resetShadowPolicyForTests() {
    shadowEngine = undefined;
}
function loadShadowEngine() {
    if (shadowEngine !== undefined)
        return shadowEngine;
    const path = process.env['MASTYF_AI_POLICY_SHADOW_PATH']?.trim();
    if (!path || !existsSync(path)) {
        shadowEngine = null;
        return null;
    }
    try {
        const raw = readFileSync(path, 'utf-8');
        const config = parsePolicyConfig(load(raw));
        shadowEngine = new PolicyEngine(config);
        Logger.info(`[shadow-policy] Loaded shadow policy from ${path}`);
        return shadowEngine;
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        Logger.warn(`[shadow-policy] Failed to load ${path}: ${message}`);
        shadowEngine = null;
        return null;
    }
}
/** Evaluate shadow policy; never enforces — logs shadow_would_block when applicable. */
export async function evaluateShadowPolicy(context) {
    const engine = loadShadowEngine();
    if (!engine)
        return;
    const decision = await engine.evaluateAsync(context);
    if (decision.action === 'block') {
        StructuredLogger.info({
            event: 'shadow_would_block',
            serverName: context.serverName,
            toolName: context.toolName,
            rule: decision.rule,
            reason: decision.reason,
            tenantId: context.tenantId,
            requestId: context.requestId,
        });
    }
}
//# sourceMappingURL=shadow-policy.js.map