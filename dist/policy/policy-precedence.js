/**
 * Policy evaluation precedence (highest first):
 * 1. OPA/Rego — block from OPA_URL wins over everything
 * 2. YAML PolicyEngine rules
 * 3. default_action (inside PolicyEngine.evaluate)
 *
 * OPA pass or unavailable does not short-circuit YAML; only an OPA block stops evaluation.
 */
export function resolvePolicyPrecedence(opaDecision, yamlDecision) {
    if (opaDecision?.action === 'block')
        return opaDecision;
    return yamlDecision;
}
//# sourceMappingURL=policy-precedence.js.map