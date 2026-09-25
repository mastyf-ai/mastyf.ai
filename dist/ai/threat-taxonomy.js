export const CORPUS_CATEGORIES = [
    'prompt-injection',
    'shell-obfuscation',
    'credential-exfil',
    'ssrf-url',
    'sql-nosql',
    'cross-tool-chain',
    'threat-intel',
];
const RULE_TO_CATEGORY = {
    'semantic-shell-guard': 'shell-obfuscation',
    'secret-scan': 'credential-exfil',
    'path-guard': 'cross-tool-chain',
    'sensitive-path': 'cross-tool-chain',
    'semantic-prompt-injection': 'prompt-injection',
    'sql-injection': 'sql-nosql',
    'ssrf-guard': 'ssrf-url',
};
const SEMANTIC_CATEGORY_MAP = {
    'prompt-injection': 'prompt-injection',
    exfiltration: 'credential-exfil',
    'encoded-payload': 'shell-obfuscation',
    injection: 'sql-nosql',
    'privilege-escalation': 'cross-tool-chain',
    'tool-chain': 'cross-tool-chain',
    none: 'prompt-injection',
};
const ATTACK_CLASS_HINTS = [
    [/prompt|injection|jailbreak|ignore/i, 'prompt-injection'],
    [/shell|obfus|exec|bash|cmd/i, 'shell-obfuscation'],
    [/secret|credential|exfil|token|password/i, 'credential-exfil'],
    [/ssrf|url|dns|rebind/i, 'ssrf-url'],
    [/sql|nosql|injection/i, 'sql-nosql'],
    [/chain|traversal|path/i, 'cross-tool-chain'],
    [/cve|threat-intel|nvd|osv|ghsa/i, 'threat-intel'],
];
export function normalizeAttackClassSlug(raw) {
    return raw
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
}
export function categoryFromBlockRule(rule) {
    return RULE_TO_CATEGORY[rule] || 'prompt-injection';
}
export function categoryFromSemanticCategories(categories) {
    for (const c of categories || []) {
        const mapped = SEMANTIC_CATEGORY_MAP[c.toLowerCase()];
        if (mapped && mapped !== 'prompt-injection')
            return mapped;
    }
    const first = categories?.[0]?.toLowerCase();
    if (first && SEMANTIC_CATEGORY_MAP[first])
        return SEMANTIC_CATEGORY_MAP[first];
    return 'prompt-injection';
}
export function categoryFromAttackClass(attackClass) {
    for (const [re, cat] of ATTACK_CLASS_HINTS) {
        if (re.test(attackClass))
            return cat;
    }
    return 'prompt-injection';
}
export function attackClassFromBlockRule(rule) {
    const explicit = {
        'secret-scan': 'secret-exfil',
        'path-guard': 'path-traversal',
        'sensitive-path': 'path-traversal',
        'semantic-shell-guard': 'prompt-injection',
        'sql-exfil': 'sql-injection',
        'sql-injection': 'sql-injection',
        'arg-entropy': 'obfuscation',
        'ssrf-guard': 'ssrf-url',
    };
    if (explicit[rule])
        return explicit[rule];
    return categoryFromBlockRule(rule);
}
export function normalizeDiscoveryClassification(discovery) {
    const attackClass = normalizeAttackClassSlug(discovery.attackClass);
    if (!attackClass) {
        throw new Error('invalid attackClass after normalization');
    }
    let category = discovery.corpusCandidate.category?.trim() || '';
    if (!CORPUS_CATEGORIES.includes(category)) {
        category = categoryFromAttackClass(attackClass);
    }
    return {
        ...discovery,
        attackClass,
        corpusCandidate: {
            ...discovery.corpusCandidate,
            category,
            ruleHint: discovery.corpusCandidate.ruleHint || attackClass,
        },
    };
}
//# sourceMappingURL=threat-taxonomy.js.map