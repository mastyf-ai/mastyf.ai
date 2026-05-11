import { z } from 'zod';

export const McpServerConfigSchema = z.object({
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  url: z.string().url().optional(),
  transport: z.enum(['stdio', 'sse']).optional(),
});

export const PolicyRuleSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  action: z.enum(['pass', 'block', 'flag']),
  tools: z.object({
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
  }).optional(),
  patterns: z.array(z.string()).optional(),
  maxTokens: z.number().optional(),
  maxCallsPerMinute: z.number().optional(),
  rbac: z.object({
    scopes: z.array(z.string()).optional(),
    clientIds: z.array(z.string()).optional(),
  }).optional(),
});

export const PolicyConfigSchema = z.object({
  version: z.string(),
  policy: z.object({
    mode: z.enum(['audit', 'warn', 'block']),
    rules: z.array(PolicyRuleSchema),
  }),
});

export type ValidatedMcpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type ValidatedPolicyConfig = z.infer<typeof PolicyConfigSchema>;