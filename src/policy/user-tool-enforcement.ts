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

interface PerUserAllowlistEntry {
  userId: string;
  serverName: string;
  toolName: string;
}

interface PerUserPathRule {
  userId: string;
  pathPattern: RegExp;
  action: 'allow' | 'deny';
}

export class UserToolEnforcementEngine {
  private userToolAllowlists = new Map<string, Set<string>>();
  private userToolDenylists = new Map<string, Set<string>>();
  private userPathRules = new Map<string, PerUserPathRule[]>();
  private userRateLimits = new Map<string, number>();
  private userTokenLimits = new Map<string, number>();
  private registeredPolicies: UserToolPolicy[] = [];

  getPolicies(): UserToolPolicy[] {
    return this.registeredPolicies;
  }

  registerUserPolicies(policies: UserToolPolicy[]): void {
    this.registeredPolicies.push(...policies);
    for (const policy of policies) {
      const uid = policy.userId;

      const allowSet = new Set(policy.allowedTools);
      this.userToolAllowlists.set(uid, allowSet);

      const denySet = new Set(policy.deniedTools);
      this.userToolDenylists.set(uid, denySet);

      if (policy.rateLimitPerMinute > 0) {
        this.userRateLimits.set(uid, policy.rateLimitPerMinute);
      }

      if (policy.maxTokensPerCall > 0) {
        this.userTokenLimits.set(uid, policy.maxTokensPerCall);
      }

      const pathRules: PerUserPathRule[] = [];
      for (const path of policy.allowedPaths) {
        pathRules.push({ userId: uid, pathPattern: globToRegex(path), action: 'allow' });
      }
      for (const path of policy.deniedPaths) {
        pathRules.push({ userId: uid, pathPattern: globToRegex(path), action: 'deny' });
      }
      this.userPathRules.set(uid, pathRules);
    }
  }

  evaluate(context: CallContext): PolicyDecision | null {
    const identity = context.agentIdentity;
    if (!identity || !identity.sub) return null;

    const userId = identity.sub;
    const serverTool = `${context.serverName}:${context.toolName}`;

    const denied = this.userToolDenylists.get(userId);
    if (denied && denied.has(context.toolName)) {
      return {
        action: 'block',
        rule: 'per-user-tool-deny',
        reason: `User ${userId} is denied access to tool ${context.toolName}`,
      };
    }

    const allowed = this.userToolAllowlists.get(userId);
    if (allowed && allowed.size > 0 && !allowed.has(context.toolName)) {
      return {
        action: 'block',
        rule: 'per-user-tool-allowlist',
        reason: `User ${userId} does not have access to tool ${context.toolName}`,
      };
    }

    const pathRules = this.userPathRules.get(userId);
    if (pathRules && pathRules.length > 0 && context.arguments) {
      for (const pathKey of ['path', 'file', 'directory', 'target', 'source']) {
        const pathValue = (context.arguments as Record<string, unknown>)[pathKey];
        if (typeof pathValue !== 'string') continue;

        for (const rule of pathRules) {
          if (rule.pathPattern.test(pathValue)) {
            if (rule.action === 'deny') {
              return {
                action: 'block',
                rule: 'per-user-path-deny',
                reason: `User ${userId} denied access to path ${pathValue}`,
              };
            }
          }
        }
      }
    }

    const tokenLimit = this.userTokenLimits.get(userId);
    if (tokenLimit && context.requestTokens > tokenLimit) {
      return {
        action: 'block',
        rule: 'per-user-token-budget',
        reason: `User ${userId} exceeded per-call token budget (${context.requestTokens} > ${tokenLimit})`,
      };
    }

    const agentRoles = identity.scopes || [];
    const rolePolicy = this.getEffectiveRolePolicy(agentRoles);
    if (rolePolicy) {
      if (rolePolicy.deniedTools.length > 0 && rolePolicy.deniedTools.includes(context.toolName)) {
        return { action: 'block', rule: 'per-role-tool-deny', reason: `Role policy denies tool ${context.toolName}` };
      }
      if (rolePolicy.allowedTools.length > 0 && !rolePolicy.allowedTools.includes(context.toolName)) {
        return { action: 'block', rule: 'per-role-tool-allowlist', reason: `Role policy does not allow tool ${context.toolName}` };
      }
      if (rolePolicy.rateLimitPerMinute > 0 && (this.getUserRateLimit(userId) === 0)) {
        this.userRateLimits.set(userId, rolePolicy.rateLimitPerMinute);
      }
      if (rolePolicy.maxTokensPerCall > 0 && (this.getUserTokenLimit(userId) === 0)) {
        this.userTokenLimits.set(userId, rolePolicy.maxTokensPerCall);
      }
    }

    return null;
  }

  getUserRateLimit(userId: string): number {
    return this.userRateLimits.get(userId) || 0;
  }

  getUserTokenLimit(userId: string): number {
    return this.userTokenLimits.get(userId) || 0;
  }

  private rolePolicies = new Map<string, RoleToolPolicy>();

  registerRolePolicies(policies: RoleToolPolicy[]): void {
    for (const p of policies) this.rolePolicies.set(p.roleName, p);
  }

  private getEffectiveRolePolicy(roles: string[]): RoleToolPolicy | null {
    for (const role of roles) {
      const p = this.rolePolicies.get(role);
      if (p) return p;
    }
    return null;
  }
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}
