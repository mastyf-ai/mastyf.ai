import { dump, load } from 'js-yaml';
function parsePolicyDoc(yaml) {
    const parsed = load(yaml);
    if (!parsed || typeof parsed !== 'object')
        throw new Error('Invalid policy YAML');
    const doc = parsed;
    if (!doc.policy || typeof doc.policy !== 'object')
        throw new Error('Missing policy block');
    if (!Array.isArray(doc.policy.rules))
        throw new Error('Missing policy.rules array');
    return doc;
}
function dumpPolicyDoc(doc) {
    return dump(doc, { noRefs: true, lineWidth: -1 });
}
export function listActiveRules(yaml) {
    const doc = parsePolicyDoc(yaml);
    const rules = doc.policy?.rules ?? [];
    return rules.map((rule) => ({
        name: rule.name,
        action: rule.action,
        enabled: rule.enabled !== false,
        description: rule.description,
        allowCount: rule.tools?.allow?.length ?? 0,
        denyCount: rule.tools?.deny?.length ?? 0,
        patternCount: rule.patterns?.length ?? 0,
        argPatternCount: rule.argPatterns?.length ?? 0,
    }));
}
export function togglePolicyRule(yaml, ruleName, enabled) {
    const doc = parsePolicyDoc(yaml);
    const rules = doc.policy?.rules ?? [];
    const idx = rules.findIndex((r) => r.name === ruleName);
    if (idx < 0)
        throw new Error(`Rule not found: ${ruleName}`);
    rules[idx] = { ...rules[idx], enabled };
    return dumpPolicyDoc(doc);
}
export function deletePolicyRule(yaml, ruleName) {
    const doc = parsePolicyDoc(yaml);
    const rules = doc.policy?.rules ?? [];
    const next = rules.filter((r) => r.name !== ruleName);
    if (next.length === rules.length)
        throw new Error(`Rule not found: ${ruleName}`);
    doc.policy = { ...(doc.policy ?? {}), rules: next };
    return dumpPolicyDoc(doc);
}
//# sourceMappingURL=policy-rule-ops.js.map