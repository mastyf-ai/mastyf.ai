import type { CallContext, PolicyDecision } from './policy-types.js';
export interface UserToolPolicy {
    userId: string;
    username: string;
    tenantId: string;
    roles: string[];
    allowedTools: string[];
    deniedTools: string[];
    rateLimitPerMinute: number;
    maxTokensPerCall: number;
    allowedPaths: string[];
    deniedPaths: string[];
}
export interface RoleToolPolicy {
    roleName: string;
    tenantId: string;
    allowedTools: string[];
    deniedTools: string[];
    rateLimitPerMinute: number;
    maxTokensPerCall: number;
    allowedPaths: string[];
    deniedPaths: string[];
}
export declare class UserToolEnforcementEngine {
    private userToolAllowlists;
    private userToolDenylists;
    private userPathRules;
    private userRateLimits;
    private userTokenLimits;
    private registeredPolicies;
    getPolicies(): UserToolPolicy[];
    registerUserPolicies(policies: UserToolPolicy[]): void;
    evaluate(context: CallContext): PolicyDecision | null;
    getUserRateLimit(userId: string): number;
    getUserTokenLimit(userId: string): number;
    private rolePolicies;
    registerRolePolicies(policies: RoleToolPolicy[]): void;
    private getEffectiveRolePolicy;
}
//# sourceMappingURL=user-tool-enforcement.d.ts.map