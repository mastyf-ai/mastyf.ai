import { PolicyConfig, PolicyDecision, CallContext, PolicyAction, PolicyMode } from './policy-types.js';
import { Logger } from '../utils/logger.js';
import { getNormalizer } from '../utils/payload-normalizer.js';
import { isFpWhitelisted } from '../ai/fp-whitelist.js';
import { ShellTokenizer } from './shell-tokenizer.js';
import { LRUCache } from 'lru-cache';
import { resolvePolicyPrecedence } from './policy-precedence.js';
import {
  getCachedPolicyDecision,
  isPolicyEvalCacheEnabled,
  policyEvalCacheKey,
  setCachedPolicyDecision,
  shouldCachePolicyDecision,
} from './policy-eval-cache.js';
import { walkStringLeaves } from './arg-leaf-walker.js';
import { detectPromptInjection } from '../scanners/prompt-injection-detector.js';
import {
  SYNC_POLICY_STRATEGIES,
  evaluateIdempotency,
  evaluateRedisRateLimit,
  opaStrategy,
  runShadowPolicy,
  yamlRulesStrategy,
  type PolicyEngineDeps,
  type SyncEvaluateContext,
} from './strategies/index.js';

/**
 * Policy Engine — evaluates every intercepted tools/call against configured rules.
 * Supports three modes: audit (passive), warn (flag only), block (active enforcement).
 *
 * v1.2: Integrated payload normalization and semantic shell analysis layers
 * v2.1: Replaced Map with LRUCache to prevent memory leaks under sustained load
 * v2.9: Strategy-pattern pipeline under src/policy/strategies/
 */
export class PolicyEngine {
  private rules: PolicyConfig['policy']['rules'];
  private mode: PolicyMode;
  private config: PolicyConfig;
  private callCounters: LRUCache<string, { count: number; resetAt: number }> = new LRUCache({
    max: 50000,
    ttl: 60000,
    updateAgeOnGet: false,
  });
  private normalizer: ReturnType<typeof getNormalizer>;
  private shellTokenizer = new ShellTokenizer();

  private compiledPatterns: Map<string, { compiled: RegExp[]; rule: PolicyConfig['policy']['rules'][number] }[]> = new Map();
  private compiledArgPatterns: Map<string, { field: string; compiled: RegExp[]; rule: PolicyConfig['policy']['rules'][number] }[]> = new Map();

  constructor(config: PolicyConfig) {
    this.rules = config.policy.rules;
    this.mode = config.policy.mode;
    this.config = config;
    this.normalizer = getNormalizer(config.policy.unicode_strict !== false);
    this.compilePatterns();
  }

  private compilePatterns(): void {
    for (const rule of this.rules) {
      if (rule.patterns?.length) {
        try {
          const compiled = rule.patterns.map(p => new RegExp(p, 'i'));
          this.compiledPatterns.set(rule.name, [
            ...(this.compiledPatterns.get(rule.name) || []),
            { compiled, rule },
          ]);
        } catch {
          Logger.warn(`Policy: invalid regex in rule '${rule.name}' patterns — skipping pre-compilation`);
        }
      }
      if (rule.argPatterns?.length) {
        for (const ap of rule.argPatterns) {
          try {
            const compiled = ap.patterns.map(p => new RegExp(p, 'i'));
            this.compiledArgPatterns.set(rule.name, [
              ...(this.compiledArgPatterns.get(rule.name) || []),
              { field: ap.field, compiled, rule },
            ]);
          } catch {
            Logger.warn(`Policy: invalid regex in rule '${rule.name}' argPatterns — skipping pre-compilation`);
          }
        }
      }
    }
  }

  private extractLeafValues(obj: unknown): string[] {
    return walkStringLeaves(obj).map((l) => l.value);
  }

  private buildDeps(): PolicyEngineDeps {
    return {
      config: this.config,
      rules: this.rules,
      mode: this.mode,
      normalizer: this.normalizer,
      shellTokenizer: this.shellTokenizer,
      compiledPatterns: this.compiledPatterns,
      compiledArgPatterns: this.compiledArgPatterns,
      callCounters: this.callCounters,
      resolveAction: (a) => this.resolveAction(a),
      extractLeafValues: (o) => this.extractLeafValues(o),
      evaluateRule: (rule, ctx, analysis, skip) =>
        this.evaluateRule(rule, ctx, analysis, skip),
    };
  }

  isOpaEnabled(): boolean {
    if (!process.env['OPA_URL']) return false;
    if (this.config.policy.opa === false) return false;
    return this.config.policy.opa === true || process.env['GUARDIAN_OPA_ENABLED'] === 'true';
  }

  async evaluateAsync(context: CallContext): Promise<PolicyDecision> {
    runShadowPolicy(context);

    const idempotencyDecision = await evaluateIdempotency(context, this.mode);
    if (idempotencyDecision) return idempotencyDecision;

    const deps = this.buildDeps();
    const opaDecision = this.isOpaEnabled()
      ? await opaStrategy.evaluateAsync(context, deps)
      : null;

    const { decision: rateDecision, skipLocalRateLimit } = await evaluateRedisRateLimit(context, deps);
    if (rateDecision) {
      return resolvePolicyPrecedence(opaDecision, rateDecision);
    }

    if (isPolicyEvalCacheEnabled()) {
      const cacheKey = policyEvalCacheKey(context);
      const cached = await getCachedPolicyDecision(cacheKey);
      if (cached) return resolvePolicyPrecedence(opaDecision, cached);
    }

    const yamlDecision = this.evaluate(context, { skipLocalRateLimit });
    const finalDecision = resolvePolicyPrecedence(opaDecision, yamlDecision);
    if (isPolicyEvalCacheEnabled() && shouldCachePolicyDecision(finalDecision)) {
      await setCachedPolicyDecision(policyEvalCacheKey(context), finalDecision);
    }
    return finalDecision;
  }

  /** Clear in-memory per-minute call counters (harness / isolated rate-limit suites). */
  resetRateCounters(): void {
    this.callCounters.clear();
  }

  evaluate(
    context: CallContext,
    options?: { skipLocalRateLimit?: boolean; yamlOnly?: boolean },
  ): PolicyDecision {
    const normalizedArgs = context.arguments
      ? this.normalizer.normalizeJsonValue(context.arguments) as Record<string, unknown>
      : {};
    const normalizedContext: CallContext = {
      ...context,
      arguments: normalizedArgs,
    };
    const argsStr = JSON.stringify(normalizedArgs);

    const syncCtx: SyncEvaluateContext = {
      raw: context,
      normalized: normalizedContext,
      argsStr,
      skipLocalRateLimit: options?.skipLocalRateLimit,
    };

    const deps = this.buildDeps();
    const strategies = options?.yamlOnly
      ? SYNC_POLICY_STRATEGIES.filter((s) => s === yamlRulesStrategy)
      : SYNC_POLICY_STRATEGIES;
    for (const strategy of strategies) {
      const decision = strategy.evaluate(syncCtx, deps);
      if (decision) return decision;
    }

    const defaultAction = this.config.policy.default_action ?? 'pass';
    return {
      action: this.resolveAction(defaultAction),
      rule: 'default',
      reason: `No matching rule — applying default_action: ${defaultAction}`,
    };
  }

  private evaluateRule(
    rule: PolicyConfig['policy']['rules'][number],
    ctx: CallContext,
    analysis: { argsStr: string },
    skipLocalRateLimit = false,
  ): PolicyDecision | null {
    if (rule.tools) {
      if (rule.tools.allow && rule.tools.allow.length > 0) {
        if (!rule.tools.allow.includes(ctx.toolName)) {
          if (rule.tools.enforceAllowlist) {
            return {
              action: this.resolveAction(rule.action),
              rule: rule.name,
              reason: `Tool '${ctx.toolName}' not in allowlist: [${rule.tools.allow.join(', ')}]`,
            };
          }
          return null;
        }
      }
      if (rule.tools.deny && rule.tools.deny.length > 0) {
        if (rule.tools.deny.includes(ctx.toolName)) {
          return { action: this.resolveAction(rule.action), rule: rule.name, reason: `Tool '${ctx.toolName}' is explicitly denied` };
        }
      }
    }

    if (rule.toolCategories?.deny) {
      const toolLower = ctx.toolName.toLowerCase();
      const matchesCategory = rule.toolCategories.deny.some(
        (cat) => toolLower.includes(cat.toLowerCase()),
      );
      const isException = (rule.toolAllowExceptions ?? []).includes(ctx.toolName);
      if (matchesCategory && !isException) {
        return {
          action: this.resolveAction(rule.action),
          rule: rule.name,
          reason: `Tool '${ctx.toolName}' matches destructive category in rule '${rule.name}'`,
        };
      }
    }

    if (ctx.arguments) {
      const compiledAps = this.compiledArgPatterns.get(rule.name) || [];
      for (const { field, compiled, rule: r } of compiledAps) {
        if (r.name !== rule.name) continue;
        const values: string[] = field === '*'
          ? this.extractLeafValues(ctx.arguments)
          : (ctx.arguments[field] !== undefined ? this.extractLeafValues(ctx.arguments[field]) : []);
        for (const value of values) {
          for (const regex of compiled) {
            if (regex.test(value)) {
              const patternKey = `${field}:${regex.source}`;
              if (isFpWhitelisted(rule.name, patternKey)) continue;
              return {
                action: this.resolveAction(rule.action),
                rule: rule.name,
                reason: `Argument field '${field}' matches blocked pattern in rule '${rule.name}'`,
              };
            }
          }
        }
      }
    }

    if (ctx.arguments) {
      const compiledPs = this.compiledPatterns.get(rule.name) || [];
      for (const { compiled, rule: r } of compiledPs) {
        if (r.name !== rule.name) continue;
        for (const regex of compiled) {
          if (regex.test(analysis.argsStr)) {
            if (isFpWhitelisted(rule.name, regex.source)) continue;
            return { action: this.resolveAction(rule.action), rule: rule.name, reason: `Argument pattern matched in tool call (normalized)` };
          }
        }
      }
    }

    if (rule.maxTokens && ctx.requestTokens > rule.maxTokens) {
      return { action: this.resolveAction(rule.action), rule: rule.name, reason: `Token count ${ctx.requestTokens} exceeds max ${rule.maxTokens}` };
    }

    if (rule.rbac) {
      const identity = ctx.agentIdentity;
      if (!identity) {
        return { action: this.resolveAction(rule.action), rule: rule.name, reason: `RBAC rule '${rule.name}' requires agent identity but none provided` };
      }
      if (rule.rbac.scopes && rule.rbac.scopes.length > 0) {
        const agentScopes = identity.scopes || [];
        const hasScope = rule.rbac.scopes.some((required) =>
          agentScopes.some((s) => s.toLowerCase() === required.toLowerCase()),
        );
        if (!hasScope) {
          return { action: this.resolveAction(rule.action), rule: rule.name, reason: `Agent '${identity.sub}' missing required scope. Need one of: [${rule.rbac.scopes.join(', ')}], have: [${agentScopes.join(', ') || 'none'}]` };
        }
      }
      if (rule.rbac.clientIds && rule.rbac.clientIds.length > 0) {
        const clientId = identity.clientId || '';
        const matches = rule.rbac.clientIds.some(pattern => {
          try {
            return new RegExp(pattern).test(clientId);
          } catch {
            Logger.warn(`Policy: invalid clientId regex pattern in rule '${rule.name}': ${pattern}`);
            return false;
          }
        });
        if (!matches) {
          return { action: this.resolveAction(rule.action), rule: rule.name, reason: `Client ID '${clientId}' not allowed. Allowed patterns: [${rule.rbac.clientIds.join(', ')}]` };
        }
      }
      if (rule.rbac.tenants && rule.rbac.tenants.length > 0) {
        const requestTenant = ctx.tenantId || process.env['GUARDIAN_TENANT_ID'] || 'default';
        if (!rule.rbac.tenants.includes(requestTenant)) {
          return {
            action: this.resolveAction(rule.action),
            rule: rule.name,
            reason: `Tenant '${requestTenant}' not allowed for rule '${rule.name}'. Allowed: [${rule.rbac.tenants.join(', ')}]`,
          };
        }
      }
    }

    if (rule.maxCallsPerMinute && !skipLocalRateLimit) {
      const tenant = ctx.tenantId || process.env['GUARDIAN_TENANT_ID'] || 'default';
      const clientId = ctx.agentIdentity?.clientId || ctx.agentIdentity?.sub;
      const key = clientId
        ? `${tenant}:${ctx.serverName}:${ctx.toolName}:${clientId}`
        : `${tenant}:${ctx.serverName}:${ctx.toolName}`;
      const now = Date.now();
      let counter = this.callCounters.get(key);
      if (!counter || now > counter.resetAt) {
        counter = { count: 1, resetAt: now + 60000 };
      } else {
        counter.count++;
      }
      this.callCounters.set(key, counter);
      if (counter.count > rule.maxCallsPerMinute) {
        return { action: this.resolveAction(rule.action), rule: rule.name, reason: `Rate limit exceeded: ${counter.count}/${rule.maxCallsPerMinute} calls per minute` };
      }
    }

    return null;
  }

  private resolveAction(ruleAction: PolicyAction): PolicyAction {
    if (this.mode === 'audit') return 'pass';
    if (this.mode === 'warn' && ruleAction === 'block') return 'flag';
    return ruleAction;
  }

  getMode(): PolicyMode {
    return this.mode;
  }

  getRules(): ReadonlyArray<PolicyConfig['policy']['rules'][number]> {
    return this.rules;
  }

  getRuleCount(): number {
    return this.rules.length;
  }

  private static RESPONSE_EXFILTRATION_PATTERNS: RegExp[] = [
    /\b(?:curl|wget|fetch|XMLHttpRequest|axios)\b.*\b(?:https?:\/\/[^\s"']+)/i,
    /\b(?:curl|wget)\b\s+.*(?:\b[a-zA-Z0-9][-a-zA-Z0-9]*\.(?:com|net|org|io|dev|xyz|ru|cn|tk|ml|ga|cf|gq|pw|top|club|online|site|website|space|fun|host|press|digital|world|life|co|me|us|eu|info|biz|pro|name|tv|cc|ws|fm|to|am|ai))/i,
    /\$\(\s*(?:cat|head|tail|less|strings)\s+.*(?:~\/\.ssh|~\/\.aws|\.env|\.config|id_rsa|id_ed25519|authorized_keys|known_hosts|credentials|secret)/i,
    /`[^`]*(?:cat|head|tail)\s+.*(?:~\/\.ssh|id_rsa|\.env|credentials|secret)[^`]*`/,
    /\?token=[A-Za-z0-9\-_]{20,}/i,
    /\b(?:send|post|upload|transmit)\b.*\b(?:secret|key|token|password|credential)/i,
  ];

  evaluateResponse(
    toolName: string,
    serverName: string,
    responseBody: string | null | undefined,
  ): { clean: boolean; detections: string[] } {
    void serverName;
    const detections: string[] = [];

    if (responseBody == null || typeof responseBody !== 'string') {
      return { clean: true, detections };
    }

    const injectionFindings = detectPromptInjection(toolName, responseBody);
    for (const f of injectionFindings) {
      detections.push(`Prompt injection (${f.severity}): ${f.patternId} — ${f.description}`);
    }

    for (const pattern of PolicyEngine.RESPONSE_EXFILTRATION_PATTERNS) {
      if (pattern.test(responseBody)) {
        detections.push(`Data exfiltration: response matches '${pattern.source}'`);
      }
    }

    const b64chunks = [...responseBody.matchAll(/[A-Za-z0-9+/]{100,}={0,2}/g)];
    for (const chunk of b64chunks) {
      try {
        const decoded = Buffer.from(chunk[0], 'base64').toString('utf-8');
        if (/\b(bash|sh|cmd|powershell|eval|exec|curl|wget)\b/.test(decoded)) {
          detections.push('Base64-encoded shell command detected in response');
          break;
        }
      } catch {
        // Not valid base64 — ignore
      }
    }

    return { clean: detections.length === 0, detections };
  }

  getShellTokenizer(): ShellTokenizer {
    return this.shellTokenizer;
  }
}
