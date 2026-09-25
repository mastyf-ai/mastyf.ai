import type { PolicyDecision } from '../policy/policy-types.js';
import type { AgentIdentity } from '../auth/auth-types.js';
export interface ToolCallInput {
    serverName: string;
    toolName: string;
    arguments: Record<string, unknown>;
    requestId: string | number;
    identity?: AgentIdentity;
    tenantId?: string;
    headers?: Record<string, string>;
}
export interface ToolCallResult {
    success: boolean;
    output: unknown;
    error?: string;
    durationMs: number;
    toolName: string;
    serverName: string;
}
export interface HookContext {
    tool: ToolCallInput;
    identity?: AgentIdentity;
    tenantId?: string;
    policyDecision?: PolicyDecision;
    timestamp: string;
    hookState: Map<string, unknown>;
}
export interface BeforeToolCallHook {
    name: string;
    version?: string;
    priority: number;
    beforeToolCall(context: HookContext): Promise<{
        allowed: boolean;
        reason?: string;
        modifiedArgs?: Record<string, unknown>;
    }>;
}
export interface AfterToolCallHook {
    name: string;
    version?: string;
    priority: number;
    afterToolCall(context: HookContext, result: ToolCallResult): Promise<{
        allowed: boolean;
        reason?: string;
        modifiedResult?: unknown;
    }>;
}
export interface ErrorHook {
    name: string;
    version?: string;
    onError(context: HookContext, error: Error): Promise<void>;
}
export declare class ToolCallHookRegistry {
    private beforeHooks;
    private afterHooks;
    private errorHooks;
    registerBefore(hook: BeforeToolCallHook): void;
    registerAfter(hook: AfterToolCallHook): void;
    registerError(hook: ErrorHook): void;
    enableHook(name: string): void;
    disableHook(name: string): void;
    private setHookEnabled;
    runBeforeHooks(context: HookContext): Promise<{
        allowed: boolean;
        reason?: string;
        args?: Record<string, unknown>;
    }>;
    runAfterHooks(context: HookContext, result: ToolCallResult): Promise<{
        allowed: boolean;
        reason?: string;
        result?: unknown;
    }>;
    runErrorHooks(context: HookContext, error: Error): Promise<void>;
    listHooks(): {
        name: string;
        type: 'before' | 'after' | 'error';
        enabled: boolean;
        priority?: number;
    }[];
}
export declare function createRateLimitHook(options: {
    maxCallsPerMinute: number;
    perUser?: boolean;
}): BeforeToolCallHook;
export declare function createPiiRedactionHook(fields: string[]): AfterToolCallHook;
export declare function createSensitivePathGuard(allowedPaths: string[], deniedPaths: string[]): BeforeToolCallHook;
export declare function createSlackNotifierHook(webhookUrl: string): BeforeToolCallHook;
export declare function createSlackBlockNotifierHook(webhookUrl: string): AfterToolCallHook;
export declare function createPagerDutyHook(routingKey: string): AfterToolCallHook;
export declare function createTimeBasedAccessHook(config: {
    allowedHours?: [number, number];
    deniedDays?: number[];
}): BeforeToolCallHook;
export declare function createGeoFencingHook(allowedRegions: string[]): BeforeToolCallHook;
export declare function createCustomHook(name: string, code: string, type: 'before' | 'after' | 'error', priority?: number): BeforeToolCallHook | AfterToolCallHook | ErrorHook | null;
//# sourceMappingURL=tool-call-hooks.d.ts.map