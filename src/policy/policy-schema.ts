import { z } from 'zod';
import type { PolicyConfig } from './policy-types.js';

const ArgPatternSchema = z.object({
  field: z.string().min(1),
  patterns: z.array(z.string().min(1)).min(1),
});

const ToolCategorySchema = z.object({
  deny: z.array(z.string().min(1)).min(1),
});

const RbacSchema = z.object({
  scopes: z.array(z.string()).optional(),
  clientIds: z.array(z.string()).optional(),
  tenants: z.array(z.string()).optional(),
});

export const PolicyRuleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  action: z.enum(['block', 'flag', 'pass']),
  tools: z.object({
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
  }).optional(),
  patterns: z.array(z.string()).optional(),
  argPatterns: z.array(ArgPatternSchema).optional(),
  toolCategories: ToolCategorySchema.optional(),
  toolAllowExceptions: z.array(z.string()).optional(),
  maxTokens: z.number().positive().optional(),
  maxCallsPerMinute: z.number().positive().optional(),
  maxCallsPer10Seconds: z.number().positive().optional(),
  rbac: RbacSchema.optional(),
});

export const PolicySchema = z.object({
  version: z.string().min(1),
  policy: z.object({
    mode: z.enum(['audit', 'warn', 'block']),
    default_action: z.enum(['pass', 'block', 'flag']).optional(),
    semantic_shell: z.boolean().optional(),
    unicode_strict: z.boolean().optional(),
    rules: z.array(PolicyRuleSchema),
  }),
});

const MAX_POLICY_DEPTH = 20;

function getObjectDepth(obj: unknown, current = 0): number {
  if (current > MAX_POLICY_DEPTH) return current;
  if (obj === null || typeof obj !== 'object') return current;

  let max = current;
  for (const value of Object.values(obj as Record<string, unknown>)) {
    max = Math.max(max, getObjectDepth(value, current + 1));
  }
  return max;
}

/** Validate and parse policy YAML/JSON — throws ZodError on invalid config */
export function parsePolicyConfig(raw: unknown): PolicyConfig {
  const depth = getObjectDepth(raw);
  if (depth > MAX_POLICY_DEPTH) {
    throw new Error(`Policy config exceeds max nesting depth: ${depth} > ${MAX_POLICY_DEPTH}`);
  }
  return PolicySchema.parse(raw) as PolicyConfig;
}
