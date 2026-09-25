import { z } from 'zod';
export declare const McpServerConfigSchema: z.ZodEffects<z.ZodEffects<z.ZodObject<{
    command: z.ZodOptional<z.ZodString>;
    args: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    url: z.ZodOptional<z.ZodString>;
    transport: z.ZodOptional<z.ZodEnum<["stdio", "sse", "websocket"]>>;
}, "strip", z.ZodTypeAny, {
    env?: Record<string, string> | undefined;
    command?: string | undefined;
    args?: string[] | undefined;
    url?: string | undefined;
    transport?: "stdio" | "sse" | "websocket" | undefined;
}, {
    env?: Record<string, string> | undefined;
    command?: string | undefined;
    args?: string[] | undefined;
    url?: string | undefined;
    transport?: "stdio" | "sse" | "websocket" | undefined;
}>, {
    env?: Record<string, string> | undefined;
    command?: string | undefined;
    args?: string[] | undefined;
    url?: string | undefined;
    transport?: "stdio" | "sse" | "websocket" | undefined;
}, {
    env?: Record<string, string> | undefined;
    command?: string | undefined;
    args?: string[] | undefined;
    url?: string | undefined;
    transport?: "stdio" | "sse" | "websocket" | undefined;
}>, {
    env?: Record<string, string> | undefined;
    command?: string | undefined;
    args?: string[] | undefined;
    url?: string | undefined;
    transport?: "stdio" | "sse" | "websocket" | undefined;
}, {
    env?: Record<string, string> | undefined;
    command?: string | undefined;
    args?: string[] | undefined;
    url?: string | undefined;
    transport?: "stdio" | "sse" | "websocket" | undefined;
}>;
export declare const PolicyRuleSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    action: z.ZodEnum<["pass", "block", "flag"]>;
    tools: z.ZodOptional<z.ZodObject<{
        allow: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        deny: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        allow?: string[] | undefined;
        deny?: string[] | undefined;
    }, {
        allow?: string[] | undefined;
        deny?: string[] | undefined;
    }>>;
    patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    maxCallsPerMinute: z.ZodOptional<z.ZodNumber>;
    rbac: z.ZodOptional<z.ZodObject<{
        scopes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        clientIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        scopes?: string[] | undefined;
        clientIds?: string[] | undefined;
    }, {
        scopes?: string[] | undefined;
        clientIds?: string[] | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    action: "pass" | "block" | "flag";
    tools?: {
        allow?: string[] | undefined;
        deny?: string[] | undefined;
    } | undefined;
    description?: string | undefined;
    patterns?: string[] | undefined;
    maxTokens?: number | undefined;
    maxCallsPerMinute?: number | undefined;
    rbac?: {
        scopes?: string[] | undefined;
        clientIds?: string[] | undefined;
    } | undefined;
}, {
    name: string;
    action: "pass" | "block" | "flag";
    tools?: {
        allow?: string[] | undefined;
        deny?: string[] | undefined;
    } | undefined;
    description?: string | undefined;
    patterns?: string[] | undefined;
    maxTokens?: number | undefined;
    maxCallsPerMinute?: number | undefined;
    rbac?: {
        scopes?: string[] | undefined;
        clientIds?: string[] | undefined;
    } | undefined;
}>;
export declare const PolicyConfigSchema: z.ZodObject<{
    version: z.ZodString;
    policy: z.ZodObject<{
        mode: z.ZodEnum<["audit", "warn", "block"]>;
        rules: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            action: z.ZodEnum<["pass", "block", "flag"]>;
            tools: z.ZodOptional<z.ZodObject<{
                allow: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
                deny: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            }, "strip", z.ZodTypeAny, {
                allow?: string[] | undefined;
                deny?: string[] | undefined;
            }, {
                allow?: string[] | undefined;
                deny?: string[] | undefined;
            }>>;
            patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            maxCallsPerMinute: z.ZodOptional<z.ZodNumber>;
            rbac: z.ZodOptional<z.ZodObject<{
                scopes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
                clientIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            }, "strip", z.ZodTypeAny, {
                scopes?: string[] | undefined;
                clientIds?: string[] | undefined;
            }, {
                scopes?: string[] | undefined;
                clientIds?: string[] | undefined;
            }>>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            action: "pass" | "block" | "flag";
            tools?: {
                allow?: string[] | undefined;
                deny?: string[] | undefined;
            } | undefined;
            description?: string | undefined;
            patterns?: string[] | undefined;
            maxTokens?: number | undefined;
            maxCallsPerMinute?: number | undefined;
            rbac?: {
                scopes?: string[] | undefined;
                clientIds?: string[] | undefined;
            } | undefined;
        }, {
            name: string;
            action: "pass" | "block" | "flag";
            tools?: {
                allow?: string[] | undefined;
                deny?: string[] | undefined;
            } | undefined;
            description?: string | undefined;
            patterns?: string[] | undefined;
            maxTokens?: number | undefined;
            maxCallsPerMinute?: number | undefined;
            rbac?: {
                scopes?: string[] | undefined;
                clientIds?: string[] | undefined;
            } | undefined;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        rules: {
            name: string;
            action: "pass" | "block" | "flag";
            tools?: {
                allow?: string[] | undefined;
                deny?: string[] | undefined;
            } | undefined;
            description?: string | undefined;
            patterns?: string[] | undefined;
            maxTokens?: number | undefined;
            maxCallsPerMinute?: number | undefined;
            rbac?: {
                scopes?: string[] | undefined;
                clientIds?: string[] | undefined;
            } | undefined;
        }[];
        mode: "warn" | "block" | "audit";
    }, {
        rules: {
            name: string;
            action: "pass" | "block" | "flag";
            tools?: {
                allow?: string[] | undefined;
                deny?: string[] | undefined;
            } | undefined;
            description?: string | undefined;
            patterns?: string[] | undefined;
            maxTokens?: number | undefined;
            maxCallsPerMinute?: number | undefined;
            rbac?: {
                scopes?: string[] | undefined;
                clientIds?: string[] | undefined;
            } | undefined;
        }[];
        mode: "warn" | "block" | "audit";
    }>;
}, "strip", z.ZodTypeAny, {
    version: string;
    policy: {
        rules: {
            name: string;
            action: "pass" | "block" | "flag";
            tools?: {
                allow?: string[] | undefined;
                deny?: string[] | undefined;
            } | undefined;
            description?: string | undefined;
            patterns?: string[] | undefined;
            maxTokens?: number | undefined;
            maxCallsPerMinute?: number | undefined;
            rbac?: {
                scopes?: string[] | undefined;
                clientIds?: string[] | undefined;
            } | undefined;
        }[];
        mode: "warn" | "block" | "audit";
    };
}, {
    version: string;
    policy: {
        rules: {
            name: string;
            action: "pass" | "block" | "flag";
            tools?: {
                allow?: string[] | undefined;
                deny?: string[] | undefined;
            } | undefined;
            description?: string | undefined;
            patterns?: string[] | undefined;
            maxTokens?: number | undefined;
            maxCallsPerMinute?: number | undefined;
            rbac?: {
                scopes?: string[] | undefined;
                clientIds?: string[] | undefined;
            } | undefined;
        }[];
        mode: "warn" | "block" | "audit";
    };
}>;
export type ValidatedMcpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type ValidatedPolicyConfig = z.infer<typeof PolicyConfigSchema>;
//# sourceMappingURL=schemas.d.ts.map