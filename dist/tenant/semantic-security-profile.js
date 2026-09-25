const PROFILE_ENV = 'MASTYF_AI_SEMANTIC_PROFILE';
export function resolveSemanticSecurityProfile() {
    const raw = process.env[PROFILE_ENV]?.trim().toLowerCase();
    if (raw === 'balanced' || raw === 'max-security')
        return raw;
    return null;
}
/** Apply profile defaults without overriding explicitly set env vars. */
export function applySemanticSecurityProfile(profile) {
    const resolved = profile ?? resolveSemanticSecurityProfile();
    if (!resolved)
        return;
    const setDefault = (key, value) => {
        if (process.env[key] === undefined)
            process.env[key] = value;
    };
    if (resolved === 'balanced') {
        setDefault('MASTYF_AI_SEMANTIC_STRICT', 'false');
        setDefault('MASTYF_AI_CORE_SEMANTIC_FAIL_CLOSED', 'false');
        setDefault('MASTYF_AI_SEMANTIC_SYNC_REQUEST', 'false');
        setDefault('MASTYF_AI_SEMANTIC_SYNC_REQUEST_LLM', 'false');
        setDefault('MASTYF_AI_SEMANTIC_ASYNC', 'true');
        setDefault('MASTYF_AI_LOCAL_SEMANTIC', 'true');
        setDefault('MASTYF_AI_SEMANTIC_TIMEOUT_MS', '500');
        setDefault('MASTYF_AI_SEMANTIC_FAIL_CLOSED_MEDIUM', 'false');
        setDefault('MASTYF_AI_SEMANTIC_FAIL_CLOSED_LOW', 'false');
        return;
    }
    setDefault('MASTYF_AI_SEMANTIC_STRICT', 'true');
    setDefault('MASTYF_AI_CORE_SEMANTIC_FAIL_CLOSED', 'true');
    setDefault('MASTYF_AI_SEMANTIC_SYNC_REQUEST', 'true');
    setDefault('MASTYF_AI_SEMANTIC_SYNC_REQUEST_LLM', 'true');
    setDefault('MASTYF_AI_SEMANTIC_ASYNC', 'true');
    setDefault('MASTYF_AI_SEMANTIC_SYNC_RESPONSE', 'true');
    setDefault('MASTYF_AI_LOCAL_SEMANTIC', 'true');
    setDefault('MASTYF_AI_SEMANTIC_SYNC_REQUEST_TIMEOUT_MS', '2500');
    setDefault('MASTYF_AI_SEMANTIC_FAIL_CLOSED_MEDIUM', 'true');
}
//# sourceMappingURL=semantic-security-profile.js.map