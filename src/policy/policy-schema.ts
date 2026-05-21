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

/** Validate and parse policy YAML/JSON — throws ZodError on invalid config */
export function parsePolicyConfig(raw: unknown): PolicyConfig {
  return PolicySchema.parse(raw) as PolicyConfig;
}
