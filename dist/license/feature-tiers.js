/**
 * Feature tiers — MIT open source by default; optional cloud license enforcement.
 */
import { resolveProCheckoutUrl } from './pro-checkout-url.js';
export const PRO_FEATURES = [
    'dashboard',
    'websocket',
    'swarm',
    'ai',
    'audit',
    'metrics',
    'cost',
    'health',
    'fleet',
    'admin',
    'multi_tenant',
    'semantic_async',
    'policy', // cloud policy sync via control plane
];
const PRO_FEATURE_SET = new Set(PRO_FEATURES);
/** Always-on community features (also included in PRO_FEATURES for telemetry). */
export const COMMUNITY_FEATURES = [
    'proxy',
    'cli',
    'policy_local',
    ...PRO_FEATURES,
];
/** Open-source edition — feature gating disabled unless MASTYF_AI_REQUIRE_LICENSE=true. */
export function isOpenCoreEnabled() {
    return true;
}
/** Test/CI license bypass — disabled in enterprise mode. */
export function isCiLicenseBypass() {
    if (process.env['MASTYF_AI_ENTERPRISE_MODE'] === 'true') {
        return false;
    }
    if (process.env['MASTYF_AI_CI_BYPASS_LICENSE'] === 'true') {
        return true;
    }
    return false;
}
/** Warn/fail startup when enterprise mode has license bypass env set. */
export function assertEnterpriseLicensePosture() {
    if (process.env['MASTYF_AI_ENTERPRISE_MODE'] !== 'true')
        return;
    if (process.env['MASTYF_AI_CI_BYPASS_LICENSE'] === 'true') {
        throw new Error('MASTYF_AI_CI_BYPASS_LICENSE is not allowed when MASTYF_AI_ENTERPRISE_MODE=true');
    }
    if (process.env['MASTYF_AI_DEV_UNLOCK_ALL'] === 'true') {
        throw new Error('MASTYF_AI_DEV_UNLOCK_ALL is not allowed when MASTYF_AI_ENTERPRISE_MODE=true');
    }
}
/** isDevUnlockAllowed removed in v3.2.3 — use a valid MASTYF_AI_LICENSE_KEY for local development. */
export const isDevUnlockAllowed = () => false;
/** Classifier only — does not gate access when license enforcement is off. */
export function isProFeature(feature) {
    return PRO_FEATURE_SET.has(feature);
}
export function allProFeatureNames() {
    return [...PRO_FEATURES];
}
export function getProCheckoutUrl() {
    return resolveProCheckoutUrl();
}
export function licenseTier(licensed) {
    return licensed ? 'pro' : 'community';
}
//# sourceMappingURL=feature-tiers.js.map