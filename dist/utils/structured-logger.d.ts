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
export declare class StructuredLogger {
    static logPolicyDecision(entry: AuditLogEntry): void;
    static logBlocked(entry: BlockLogEntry): void;
    static logError(entry: ErrorLogEntry): void;
    static info(msg: object | string): void;
    static warn(msg: object | string): void;
    static debug(msg: object | string): void;
}
//# sourceMappingURL=structured-logger.d.ts.map