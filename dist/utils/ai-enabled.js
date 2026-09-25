/**
 * AI learning & suggestion engine feature flags (enterprise defaults).
 *
 * Learning is ON unless MASTYF_AI_AI_ENABLED=false.
 * Auto-apply of generated rules is OFF unless MASTYF_AI_AI_AUTO_APPLY=true.
 */
export function isAiLearningEnabled() {
    if (process.env.MASTYF_AI_AI_ENABLED === 'false')
        return false;
    if (process.env.MASTYF_AI_AI_ENABLED === 'true')
        return true;
    // Legacy alias
    if (process.env.MASTYF_AI_EXPERIMENTAL_AI === 'true')
        return true;
    // Enterprise default: learning enabled
    return true;
}
export function isAiAutoApplyEnabled() {
    return process.env.MASTYF_AI_AI_AUTO_APPLY === 'true'
        || process.env.MASTYF_AI_EXPERIMENTAL_AI === 'true';
}
/** @deprecated Use isAiLearningEnabled */
export function isExperimentalAiEnabled() {
    return isAiLearningEnabled();
}
/** Learning on scan/audit/health CLI is opt-in (proxy/report hooks still respect MASTYF_AI_AI_ENABLED). */
export function isAiLearningOnCliCommands() {
    return process.env.MASTYF_AI_AI_ON_CLI === 'true';
}
//# sourceMappingURL=ai-enabled.js.map