import { PolicyDecision, CallContext } from '../policy/policy-types.js';
export interface AuditLogEntry {
    event: 'policy_decision';
    requestId: string | number;
    serverName: string;
    toolName: string;
    decision: PolicyDecision;
    context: CallContext;
}
export interface BlockLogEntry {
    event: 'tool_blocked';
    requestId: string | number;
    serverName: string;
    toolName: string;
    reason: string;
    rule: string;
}
export interface ErrorLogEntry {
    event: 'proxy_error' | 'oidc_discovery_error' | 'oidc_auth_error' | 'oidc_introspection_error';
    requestId?: string | number;
    serverName: string;
    error: string;
    stack?: string;
}
/**
 * Recursively sanitizes data structures for BigQuery and SIEM export.
 * BigQuery does not support nested arrays (lists of lists / ARRAY<ARRAY<T>>).
 * Any array containing another array is safely transformed so inner arrays are serialized to JSON strings.
 */
export declare function sanitizeForLogIngestion(value: unknown): unknown;
export declare class StructuredLogger {
    static logPolicyDecision(entry: AuditLogEntry): void;
    static logBlocked(entry: BlockLogEntry): void;
    static logError(entry: ErrorLogEntry): void;
    static info(msg: object | string): void;
    static warn(msg: object | string): void;
    static debug(msg: object | string): void;
}
//# sourceMappingURL=structured-logger.d.ts.map