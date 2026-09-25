import { z } from 'zod';
export const McpServerConfigSchema = z.object({
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    url: z.string().url().optional(),
    transport: z.enum(['stdio', 'sse', 'websocket']).optional(),
}).refine((config) => {
    const hasCommand = !!config.command;
    const hasUrl = !!config.url;
    return hasCommand !== hasUrl;
}, { message: "Must specify either 'command' (for stdio) or 'url' (for sse/websocket), but not both" }).refine((config) => {
    if (!config.transport)
        return true;
    if (config.transport === 'stdio')
        return !!config.command && !config.url;
    if (config.transport === 'sse' || config.transport === 'websocket') {
        return !!config.url && !config.command;
    }
    return true;
}, { message: "Transport must match connection (stdio=command, sse/websocket=url)" });
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
//# sourceMappingURL=schemas.js.map