import { z } from 'zod';
import type { PolicyConfig } from './policy-types.js';
export declare const PolicyRuleSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    action: z.ZodEnum<["block", "flag", "pass"]>;
    enabled: z.ZodOptional<z.ZodBoolean>;
    tools: z.ZodOptional<z.ZodObject<{
        allow: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        deny: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        enforceAllowlist: z.ZodOptional<z.ZodBoolean>;
    }, "strict", z.ZodTypeAny, {
        allow?: string[] | undefined;
        deny?: string[] | undefined;
        enforceAllowlist?: boolean | undefined;
    }, {
        allow?: string[] | undefined;
        deny?: string[] | undefined;
        enforceAllowlist?: boolean | undefined;
    }>>;
    patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    argPatterns: z.ZodOptional<z.ZodArray<z.ZodObject<{
        field: z.ZodString;
        patterns: z.ZodArray<z.ZodString, "many">;
    }, "strict", z.ZodTypeAny, {
        field: string;
        patterns: string[];
    }, {
        field: string;
        patterns: string[];
    }>, "many">>;
    toolCategories: z.ZodOptional<z.ZodObject<{
        deny: z.ZodArray<z.ZodString, "many">;
    }, "strict", z.ZodTypeAny, {
        deny: string[];
    }, {
        deny: string[];
    }>>;
    toolAllowExceptions: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    maxCallsPerMinute: z.ZodOptional<z.ZodNumber>;
    maxTokensPerMinute: z.ZodOptional<z.ZodNumber>;
    maxUsdPerMinute: z.ZodOptional<z.ZodNumber>;
    maxCallsPer10Seconds: z.ZodOptional<z.ZodNumber>;
    cacheable: z.ZodOptional<z.ZodBoolean>;
    rbac: z.ZodOptional<z.ZodObject<{
        scopes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        scopeMatch: z.ZodOptional<z.ZodEnum<["any", "all"]>>;
        clientIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        tenants: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strict", z.ZodTypeAny, {
        tenants?: string[] | undefined;
        scopes?: string[] | undefined;
        scopeMatch?: "any" | "all" | undefined;
        clientIds?: string[] | undefined;
    }, {
        tenants?: string[] | undefined;
        scopes?: string[] | undefined;
        scopeMatch?: "any" | "all" | undefined;
        clientIds?: string[] | undefined;
    }>>;
}, "strict", z.ZodTypeAny, {
    name: string;
    action: "pass" | "block" | "flag";
    tools?: {
        allow?: string[] | undefined;
        deny?: string[] | undefined;
        enforceAllowlist?: boolean | undefined;
    } | undefined;
    enabled?: boolean | undefined;
    description?: string | undefined;
    patterns?: string[] | undefined;
    argPatterns?: {
        field: string;
        patterns: string[];
    }[] | undefined;
    toolCategories?: {
        deny: string[];
    } | undefined;
    toolAllowExceptions?: string[] | undefined;
    maxTokens?: number | undefined;
    maxCallsPerMinute?: number | undefined;
    maxTokensPerMinute?: number | undefined;
    maxUsdPerMinute?: number | undefined;
    maxCallsPer10Seconds?: number | undefined;
    cacheable?: boolean | undefined;
    rbac?: {
        tenants?: string[] | undefined;
        scopes?: string[] | undefined;
        scopeMatch?: "any" | "all" | undefined;
        clientIds?: string[] | undefined;
    } | undefined;
}, {
    name: string;
    action: "pass" | "block" | "flag";
    tools?: {
        allow?: string[] | undefined;
        deny?: string[] | undefined;
        enforceAllowlist?: boolean | undefined;
    } | undefined;
    enabled?: boolean | undefined;
    description?: string | undefined;
    patterns?: string[] | undefined;
    argPatterns?: {
        field: string;
        patterns: string[];
    }[] | undefined;
    toolCategories?: {
        deny: string[];
    } | undefined;
    toolAllowExceptions?: string[] | undefined;
    maxTokens?: number | undefined;
    maxCallsPerMinute?: number | undefined;
    maxTokensPerMinute?: number | undefined;
    maxUsdPerMinute?: number | undefined;
    maxCallsPer10Seconds?: number | undefined;
    cacheable?: boolean | undefined;
    rbac?: {
        tenants?: string[] | undefined;
        scopes?: string[] | undefined;
        scopeMatch?: "any" | "all" | undefined;
        clientIds?: string[] | undefined;
    } | undefined;
}>;
export declare const PolicySchema: z.ZodObject<{
    version: z.ZodString;
    policy: z.ZodObject<{
        mode: z.ZodEnum<["audit", "warn", "block"]>;
        default_action: z.ZodOptional<z.ZodEnum<["pass", "block", "flag"]>>;
        semantic_shell: z.ZodOptional<z.ZodBoolean>;
        unicode_strict: z.ZodOptional<z.ZodBoolean>;
        opa: z.ZodOptional<z.ZodBoolean>;
        require_certification: z.ZodOptional<z.ZodEnum<["bronze", "silver", "gold", "platinum"]>>;
        default_sandbox_tier: z.ZodOptional<z.ZodEnum<["shadow", "redact", "allow"]>>;
        entropy: z.ZodOptional<z.ZodObject<{
            default_min: z.ZodOptional<z.ZodNumber>;
            safe_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
                fields: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
                    min_entropy: z.ZodOptional<z.ZodNumber>;
                    allow_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
                }, "strict", z.ZodTypeAny, {
                    min_entropy?: number | undefined;
                    allow_patterns?: string[] | undefined;
                }, {
                    min_entropy?: number | undefined;
                    allow_patterns?: string[] | undefined;
                }>>>;
            }, "strict", z.ZodTypeAny, {
                fields?: Record<string, {
                    min_entropy?: number | undefined;
                    allow_patterns?: string[] | undefined;
                }> | undefined;
            }, {
                fields?: Record<string, {
                    min_entropy?: number | undefined;
                    allow_patterns?: string[] | undefined;
                }> | undefined;
            }>>>;
        }, "strict", z.ZodTypeAny, {
            tools?: Record<string, {
                fields?: Record<string, {
                    min_entropy?: number | undefined;
                    allow_patterns?: string[] | undefined;
                }> | undefined;
            }> | undefined;
            default_min?: number | undefined;
            safe_patterns?: string[] | undefined;
        }, {
            tools?: Record<string, {
                fields?: Record<string, {
                    min_entropy?: number | undefined;
                    allow_patterns?: string[] | undefined;
                }> | undefined;
            }> | undefined;
            default_min?: number | undefined;
            safe_patterns?: string[] | undefined;
        }>>;
        tribunal: z.ZodOptional<z.ZodObject<{
            timeout_ms: z.ZodOptional<z.ZodNumber>;
            timeout_action: z.ZodOptional<z.ZodEnum<["block", "allow", "escalate-to-oncall"]>>;
        }, "strict", z.ZodTypeAny, {
            timeout_ms?: number | undefined;
            timeout_action?: "block" | "allow" | "escalate-to-oncall" | undefined;
        }, {
            timeout_ms?: number | undefined;
            timeout_action?: "block" | "allow" | "escalate-to-oncall" | undefined;
        }>>;
        rules: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            action: z.ZodEnum<["block", "flag", "pass"]>;
            enabled: z.ZodOptional<z.ZodBoolean>;
            tools: z.ZodOptional<z.ZodObject<{
                allow: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
                deny: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
                enforceAllowlist: z.ZodOptional<z.ZodBoolean>;
            }, "strict", z.ZodTypeAny, {
                allow?: string[] | undefined;
                deny?: string[] | undefined;
                enforceAllowlist?: boolean | undefined;
            }, {
                allow?: string[] | undefined;
                deny?: string[] | undefined;
                enforceAllowlist?: boolean | undefined;
            }>>;
            patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            argPatterns: z.ZodOptional<z.ZodArray<z.ZodObject<{
                field: z.ZodString;
                patterns: z.ZodArray<z.ZodString, "many">;
            }, "strict", z.ZodTypeAny, {
                field: string;
                patterns: string[];
            }, {
                field: string;
                patterns: string[];
            }>, "many">>;
            toolCategories: z.ZodOptional<z.ZodObject<{
                deny: z.ZodArray<z.ZodString, "many">;
            }, "strict", z.ZodTypeAny, {
                deny: string[];
            }, {
                deny: string[];
            }>>;
            toolAllowExceptions: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            maxCallsPerMinute: z.ZodOptional<z.ZodNumber>;
            maxTokensPerMinute: z.ZodOptional<z.ZodNumber>;
            maxUsdPerMinute: z.ZodOptional<z.ZodNumber>;
            maxCallsPer10Seconds: z.ZodOptional<z.ZodNumber>;
            cacheable: z.ZodOptional<z.ZodBoolean>;
            rbac: z.ZodOptional<z.ZodObject<{
                scopes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
                scopeMatch: z.ZodOptional<z.ZodEnum<["any", "all"]>>;
                clientIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
                tenants: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            }, "strict", z.ZodTypeAny, {
                tenants?: string[] | undefined;
                scopes?: string[] | undefined;
                scopeMatch?: "any" | "all" | undefined;
                clientIds?: string[] | undefined;
            }, {
                tenants?: string[] | undefined;
                scopes?: string[] | undefined;
                scopeMatch?: "any" | "all" | undefined;
                clientIds?: string[] | undefined;
            }>>;
        }, "strict", z.ZodTypeAny, {
            name: string;
            action: "pass" | "block" | "flag";
            tools?: {
                allow?: string[] | undefined;
                deny?: string[] | undefined;
                enforceAllowlist?: boolean | undefined;
            } | undefined;
            enabled?: boolean | undefined;
            description?: string | undefined;
            patterns?: string[] | undefined;
            argPatterns?: {
                field: string;
                patterns: string[];
            }[] | undefined;
            toolCategories?: {
                deny: string[];
            } | undefined;
            toolAllowExceptions?: string[] | undefined;
            maxTokens?: number | undefined;
            maxCallsPerMinute?: number | undefined;
            maxTokensPerMinute?: number | undefined;
            maxUsdPerMinute?: number | undefined;
            maxCallsPer10Seconds?: number | undefined;
            cacheable?: boolean | undefined;
            rbac?: {
                tenants?: string[] | undefined;
                scopes?: string[] | undefined;
                scopeMatch?: "any" | "all" | undefined;
                clientIds?: string[] | undefined;
            } | undefined;
        }, {
            name: string;
            action: "pass" | "block" | "flag";
            tools?: {
                allow?: string[] | undefined;
                deny?: string[] | undefined;
                enforceAllowlist?: boolean | undefined;
            } | undefined;
            enabled?: boolean | undefined;
            description?: string | undefined;
            patterns?: string[] | undefined;
            argPatterns?: {
                field: string;
                patterns: string[];
            }[] | undefined;
            toolCategories?: {
                deny: string[];
            } | undefined;
            toolAllowExceptions?: string[] | undefined;
            maxTokens?: number | undefined;
            maxCallsPerMinute?: number | undefined;
            maxTokensPerMinute?: number | undefined;
            maxUsdPerMinute?: number | undefined;
            maxCallsPer10Seconds?: number | undefined;
            cacheable?: boolean | undefined;
            rbac?: {
                tenants?: string[] | undefined;
                scopes?: string[] | undefined;
                scopeMatch?: "any" | "all" | undefined;
                clientIds?: string[] | undefined;
            } | undefined;
        }>, "many">;
    }, "strict", z.ZodTypeAny, {
        rules: {
            name: string;
            action: "pass" | "block" | "flag";
            tools?: {
                allow?: string[] | undefined;
                deny?: string[] | undefined;
                enforceAllowlist?: boolean | undefined;
            } | undefined;
            enabled?: boolean | undefined;
            description?: string | undefined;
            patterns?: string[] | undefined;
            argPatterns?: {
                field: string;
                patterns: string[];
            }[] | undefined;
            toolCategories?: {
                deny: string[];
            } | undefined;
            toolAllowExceptions?: string[] | undefined;
            maxTokens?: number | undefined;
            maxCallsPerMinute?: number | undefined;
            maxTokensPerMinute?: number | undefined;
            maxUsdPerMinute?: number | undefined;
            maxCallsPer10Seconds?: number | undefined;
            cacheable?: boolean | undefined;
            rbac?: {
                tenants?: string[] | undefined;
                scopes?: string[] | undefined;
                scopeMatch?: "any" | "all" | undefined;
                clientIds?: string[] | undefined;
            } | undefined;
        }[];
        mode: "warn" | "block" | "audit";
        entropy?: {
            tools?: Record<string, {
                fields?: Record<string, {
                    min_entropy?: number | undefined;
                    allow_patterns?: string[] | undefined;
                }> | undefined;
            }> | undefined;
            default_min?: number | undefined;
            safe_patterns?: string[] | undefined;
        } | undefined;
        default_action?: "pass" | "block" | "flag" | undefined;
        semantic_shell?: boolean | undefined;
        unicode_strict?: boolean | undefined;
        opa?: boolean | undefined;
        require_certification?: "bronze" | "silver" | "gold" | "platinum" | undefined;
        default_sandbox_tier?: "shadow" | "redact" | "allow" | undefined;
        tribunal?: {
            timeout_ms?: number | undefined;
            timeout_action?: "block" | "allow" | "escalate-to-oncall" | undefined;
        } | undefined;
    }, {
        rules: {
            name: string;
            action: "pass" | "block" | "flag";
            tools?: {
                allow?: string[] | undefined;
                deny?: string[] | undefined;
                enforceAllowlist?: boolean | undefined;
            } | undefined;
            enabled?: boolean | undefined;
            description?: string | undefined;
            patterns?: string[] | undefined;
            argPatterns?: {
                field: string;
                patterns: string[];
            }[] | undefined;
            toolCategories?: {
                deny: string[];
            } | undefined;
            toolAllowExceptions?: string[] | undefined;
            maxTokens?: number | undefined;
            maxCallsPerMinute?: number | undefined;
            maxTokensPerMinute?: number | undefined;
            maxUsdPerMinute?: number | undefined;
            maxCallsPer10Seconds?: number | undefined;
            cacheable?: boolean | undefined;
            rbac?: {
                tenants?: string[] | undefined;
                scopes?: string[] | undefined;
                scopeMatch?: "any" | "all" | undefined;
                clientIds?: string[] | undefined;
            } | undefined;
        }[];
        mode: "warn" | "block" | "audit";
        entropy?: {
            tools?: Record<string, {
                fields?: Record<string, {
                    min_entropy?: number | undefined;
                    allow_patterns?: string[] | undefined;
                }> | undefined;
            }> | undefined;
            default_min?: number | undefined;
            safe_patterns?: string[] | undefined;
        } | undefined;
        default_action?: "pass" | "block" | "flag" | undefined;
        semantic_shell?: boolean | undefined;
        unicode_strict?: boolean | undefined;
        opa?: boolean | undefined;
        require_certification?: "bronze" | "silver" | "gold" | "platinum" | undefined;
        default_sandbox_tier?: "shadow" | "redact" | "allow" | undefined;
        tribunal?: {
            timeout_ms?: number | undefined;
            timeout_action?: "block" | "allow" | "escalate-to-oncall" | undefined;
        } | undefined;
    }>;
}, "strict", z.ZodTypeAny, {
    version: string;
    policy: {
        rules: {
            name: string;
            action: "pass" | "block" | "flag";
            tools?: {
                allow?: string[] | undefined;
                deny?: string[] | undefined;
                enforceAllowlist?: boolean | undefined;
            } | undefined;
            enabled?: boolean | undefined;
            description?: string | undefined;
            patterns?: string[] | undefined;
            argPatterns?: {
                field: string;
                patterns: string[];
            }[] | undefined;
            toolCategories?: {
                deny: string[];
            } | undefined;
            toolAllowExceptions?: string[] | undefined;
            maxTokens?: number | undefined;
            maxCallsPerMinute?: number | undefined;
            maxTokensPerMinute?: number | undefined;
            maxUsdPerMinute?: number | undefined;
            maxCallsPer10Seconds?: number | undefined;
            cacheable?: boolean | undefined;
            rbac?: {
                tenants?: string[] | undefined;
                scopes?: string[] | undefined;
                scopeMatch?: "any" | "all" | undefined;
                clientIds?: string[] | undefined;
            } | undefined;
        }[];
        mode: "warn" | "block" | "audit";
        entropy?: {
            tools?: Record<string, {
                fields?: Record<string, {
                    min_entropy?: number | undefined;
                    allow_patterns?: string[] | undefined;
                }> | undefined;
            }> | undefined;
            default_min?: number | undefined;
            safe_patterns?: string[] | undefined;
        } | undefined;
        default_action?: "pass" | "block" | "flag" | undefined;
        semantic_shell?: boolean | undefined;
        unicode_strict?: boolean | undefined;
        opa?: boolean | undefined;
        require_certification?: "bronze" | "silver" | "gold" | "platinum" | undefined;
        default_sandbox_tier?: "shadow" | "redact" | "allow" | undefined;
        tribunal?: {
            timeout_ms?: number | undefined;
            timeout_action?: "block" | "allow" | "escalate-to-oncall" | undefined;
        } | undefined;
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
                enforceAllowlist?: boolean | undefined;
            } | undefined;
            enabled?: boolean | undefined;
            description?: string | undefined;
            patterns?: string[] | undefined;
            argPatterns?: {
                field: string;
                patterns: string[];
            }[] | undefined;
            toolCategories?: {
                deny: string[];
            } | undefined;
            toolAllowExceptions?: string[] | undefined;
            maxTokens?: number | undefined;
            maxCallsPerMinute?: number | undefined;
            maxTokensPerMinute?: number | undefined;
            maxUsdPerMinute?: number | undefined;
            maxCallsPer10Seconds?: number | undefined;
            cacheable?: boolean | undefined;
            rbac?: {
                tenants?: string[] | undefined;
                scopes?: string[] | undefined;
                scopeMatch?: "any" | "all" | undefined;
                clientIds?: string[] | undefined;
            } | undefined;
        }[];
        mode: "warn" | "block" | "audit";
        entropy?: {
            tools?: Record<string, {
                fields?: Record<string, {
                    min_entropy?: number | undefined;
                    allow_patterns?: string[] | undefined;
                }> | undefined;
            }> | undefined;
            default_min?: number | undefined;
            safe_patterns?: string[] | undefined;
        } | undefined;
        default_action?: "pass" | "block" | "flag" | undefined;
        semantic_shell?: boolean | undefined;
        unicode_strict?: boolean | undefined;
        opa?: boolean | undefined;
        require_certification?: "bronze" | "silver" | "gold" | "platinum" | undefined;
        default_sandbox_tier?: "shadow" | "redact" | "allow" | undefined;
        tribunal?: {
            timeout_ms?: number | undefined;
            timeout_action?: "block" | "allow" | "escalate-to-oncall" | undefined;
        } | undefined;
    };
}>;
export type PolicyValidationIssue = {
    path: string;
    message: string;
};
export declare function formatPolicyValidationErrors(err: unknown): PolicyValidationIssue[];
/** Validate and parse policy YAML/JSON — throws on invalid config with field paths */
export declare function parsePolicyConfig(raw: unknown): PolicyConfig;
/** Export JSON Schema for policy documents (IDE validation, CI). */
export declare function exportPolicyJsonSchema(): Promise<Record<string, unknown>>;
//# sourceMappingURL=policy-schema.d.ts.map