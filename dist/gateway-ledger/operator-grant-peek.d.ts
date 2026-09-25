export declare const ALLOW_GRANT_SCOPES: Set<string>;
export declare const DENY_GRANT_SCOPES: Set<string>;
export interface OperatorGrantRow {
    grant_id: string;
    tool_name: string;
    server_id?: string | null;
    server_name?: string | null;
    session_id?: string | null;
    destination?: string | null;
    remaining_uses?: number;
    expires_at?: number | null;
    scope?: string;
}
export interface GrantCallMatch {
    toolName: string;
    serverName?: string;
    serverId?: string;
    sessionId?: string;
    destination?: string;
}
export declare function resolveMastyfHome(home?: string | undefined): string;
export declare function loadOperatorGrants(home?: string): OperatorGrantRow[];
export declare function grantMatchesCall(grant: OperatorGrantRow, call: GrantCallMatch): boolean;
/** Persist shadow may skip only when an unused matching allow grant exists. */
export declare function shouldBypassPersistShadow(call: GrantCallMatch, opts?: {
    grants?: OperatorGrantRow[];
    now?: number;
    home?: string;
}): boolean;
export declare function peekMatchingAllowGrant(call: GrantCallMatch, opts?: {
    grants?: OperatorGrantRow[];
    now?: number;
    home?: string;
}): OperatorGrantRow | null;
//# sourceMappingURL=operator-grant-peek.d.ts.map