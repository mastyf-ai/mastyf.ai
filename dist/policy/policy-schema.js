import { z } from 'zod';
const ArgPatternSchema = z
    .object({
    field: z.string().min(1),
    patterns: z.array(z.string().min(1)).min(1),
})
    .strict();
const ToolCategorySchema = z
    .object({
    deny: z.array(z.string().min(1)).min(1),
})
    .strict();
const RbacSchema = z
    .object({
    scopes: z.array(z.string()).optional(),
    scopeMatch: z.enum(['any', 'all']).optional(),
    clientIds: z.array(z.string()).optional(),
    tenants: z.array(z.string()).optional(),
})
    .strict();
const EntropyFieldSchema = z
    .object({
    min_entropy: z.number().optional(),
    allow_patterns: z.array(z.string()).optional(),
})
    .strict();
const EntropyPolicySchema = z
    .object({
    default_min: z.number().optional(),
    safe_patterns: z.array(z.string()).optional(),
    tools: z
        .record(z.string(), z.object({ fields: z.record(z.string(), EntropyFieldSchema).optional() }).strict())
        .optional(),
})
    .strict();
const TribunalPolicySchema = z
    .object({
    timeout_ms: z.number().positive().optional(),
    timeout_action: z.enum(['block', 'allow', 'escalate-to-oncall']).optional(),
})
    .strict();
export const PolicyRuleSchema = z
    .object({
    name: z.string().min(1),
    description: z.string().optional(),
    action: z.enum(['block', 'flag', 'pass']),
    enabled: z.boolean().optional(),
    tools: z
        .object({
        allow: z.array(z.string()).optional(),
        deny: z.array(z.string()).optional(),
        enforceAllowlist: z.boolean().optional(),
    })
        .strict()
        .optional(),
    patterns: z.array(z.string()).optional(),
    argPatterns: z.array(ArgPatternSchema).optional(),
    toolCategories: ToolCategorySchema.optional(),
    toolAllowExceptions: z.array(z.string()).optional(),
    maxTokens: z.number().positive().optional(),
    maxCallsPerMinute: z.number().positive().optional(),
    maxTokensPerMinute: z.number().positive().optional(),
    maxUsdPerMinute: z.number().positive().optional(),
    maxCallsPer10Seconds: z.number().positive().optional(),
    cacheable: z.boolean().optional(),
    rbac: RbacSchema.optional(),
})
    .strict();
export const PolicySchema = z
    .object({
    version: z.string().min(1),
    policy: z
        .object({
        mode: z.enum(['audit', 'warn', 'block']),
        default_action: z.enum(['pass', 'block', 'flag']).optional(),
        semantic_shell: z.boolean().optional(),
        unicode_strict: z.boolean().optional(),
        opa: z.boolean().optional(),
        require_certification: z.enum(['bronze', 'silver', 'gold', 'platinum']).optional(),
        default_sandbox_tier: z.enum(['shadow', 'redact', 'allow']).optional(),
        entropy: EntropyPolicySchema.optional(),
        tribunal: TribunalPolicySchema.optional(),
        rules: z.array(PolicyRuleSchema),
    })
        .strict(),
})
    .strict();
const MAX_POLICY_DEPTH = 20;
function getObjectDepth(obj, current = 0) {
    if (current > MAX_POLICY_DEPTH)
        return current;
    if (obj === null || typeof obj !== 'object')
        return current;
    let max = current;
    for (const value of Object.values(obj)) {
        max = Math.max(max, getObjectDepth(value, current + 1));
    }
    return max;
}
export function formatPolicyValidationErrors(err) {
    if (err instanceof z.ZodError) {
        return err.errors.map((e) => ({
            path: e.path.length > 0 ? e.path.join('.') : '(root)',
            message: e.message,
        }));
    }
    return [{ path: '(root)', message: err instanceof Error ? err.message : String(err) }];
}
/** Validate and parse policy YAML/JSON — throws on invalid config with field paths */
export function parsePolicyConfig(raw) {
    const depth = getObjectDepth(raw);
    if (depth > MAX_POLICY_DEPTH) {
        throw new Error(`Policy config exceeds max nesting depth: ${depth} > ${MAX_POLICY_DEPTH}`);
    }
    try {
        return PolicySchema.parse(raw);
    }
    catch (err) {
        const issues = formatPolicyValidationErrors(err);
        throw new Error(`Invalid policy config: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
    }
}
/** Export JSON Schema for policy documents (IDE validation, CI). */
export async function exportPolicyJsonSchema() {
    const { zodToJsonSchema } = await import('zod-to-json-schema');
    return zodToJsonSchema(PolicySchema, {
        name: 'MastyfAiPolicy',
        $refStrategy: 'none',
    });
}
//# sourceMappingURL=policy-schema.js.map