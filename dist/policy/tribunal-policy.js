let cached = null;
export function setTribunalPolicyFromConfig(tribunal) {
    cached = tribunal ?? null;
}
export function getTribunalPolicyFromConfig() {
    return cached;
}
/** @internal */
export function resetTribunalPolicyForTests() {
    cached = null;
}
//# sourceMappingURL=tribunal-policy.js.map