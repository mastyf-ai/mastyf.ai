import { PolicyConfig, PolicyDecision, CallContext, PolicyAction, PolicyMode } from './policy-types.js';
import { Logger } from '../utils/logger.js';
import { getNormalizer } from '../utils/payload-normalizer.js';
import { isFpWhitelisted } from '../ai/fp-whitelist.js';
import { evaluateSemanticGuards } from './semantic-guards.js';
import { ShellTokenizer, CommandRisk } from './shell-tokenizer.js';
import { LRUCache } from 'lru-cache';
import { resolvePolicyPrecedence } from './policy-precedence.js';

/**
 * Policy Engine — evaluates every intercepted tools/call against configured rules.
 * Supports three modes: audit (passive), warn (flag only), block (active enforcement).
 *
 * v1.2: Integrated payload normalization and semantic shell analysis layers
 * v2.1: Replaced Map with LRUCache to prevent memory leaks under sustained load
 */
export class PolicyEngine {
  private rules: PolicyConfig['policy']['rules'];
  private mode: PolicyMode;
  private config: PolicyConfig;
  private callCounters: LRUCache<string, { count: number; resetAt: number }> = new LRUCache({
    max: 50000,
    ttl: 60000,
    updateAgeOnGet: true,
  });
  private normalizer: ReturnType<typeof getNormalizer>;
  private shellTokenizer = new ShellTokenizer();

  // Pre-compiled regex patterns (constructed once, not on every tools/call)
  private compiledPatterns: Map<string, { compiled: RegExp[]; rule: PolicyConfig['policy']['rules'][number] }[]> = new Map();
  private compiledArgPatterns: Map<string, { field: string; compiled: RegExp[]; rule: PolicyConfig['policy']['rules'][number] }[]> = new Map();

  constructor(config: PolicyConfig) {
    this.rules = config.policy.rules;
    this.mode = config.policy.mode;
    this.config = config;
    this.normalizer = getNormalizer(config.policy.unicode_strict !== false);
    this.compilePatterns();
  }

  /** Pre-compile all regex patterns at construction to avoid re-compilation on every tools/call */
  private compilePatterns(): void {
    for (const rule of this.rules) {
      // Compile rule.patterns
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
      // Compile rule.argPatterns
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

  /** Recursively extract all leaf string values from a nested argument object */
  private extractLeafValues(obj: unknown, prefix = ''): string[] {
    if (typeof obj === 'string') return [obj];
    if (typeof obj === 'number' || typeof obj === 'boolean') return [String(obj)];
    if (obj === null || obj === undefined) return [];
    if (Array.isArray(obj)) {
      return obj.flatMap((v, i) => this.extractLeafValues(v, `${prefix}[${i}]`));
    }
    if (typeof obj === 'object') {
      return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
        this.extractLeafValues(v, prefix ? `${prefix}.${k}` : k)
      );
    }
    return [String(obj)];
  }

  /**
   * Evaluate a tools/call request and return a decision.
   *
   * Order: (1) OPA/Rego block if OPA_URL set, (2) YAML rules + default_action.
   * Pipeline: Normalize payload → Semantic shell analysis → Rule evaluation
   */
  async evaluateAsync(context: CallContext): Promise<PolicyDecision> {
    const { evaluateOpaPolicy } = await import('./opa-policy.js');
    const opaDecision = await evaluateOpaPolicy(context);

    let yamlDecision: PolicyDecision;
    const { isRedisConfigured } = await import('../utils/redis-client.js');
    if (isRedisConfigured()) {
      const { getSharedRedisRateLimiter } = await import('../utils/redis-rate-limiter.js');
      const rl = getSharedRedisRateLimiter();
      for (const rule of this.rules) {
        if (!rule.maxCallsPerMinute) continue;
        const tenant = context.tenantId || process.env['GUARDIAN_TENANT_ID'] || 'default';
        const key = `${tenant}:${context.serverName}:${context.toolName}:${rule.name}`;
        const { allowed } = await rl.checkAndIncrement(key, rule.maxCallsPerMinute);
        if (!allowed) {
          yamlDecision = {
            action: this.resolveAction(rule.action),
            rule: rule.name,
            reason: `Rate limit exceeded: ${rule.maxCallsPerMinute} calls per minute (cluster)`,
          };
          return resolvePolicyPrecedence(opaDecision, yamlDecision);
        }
      }
      yamlDecision = this.evaluate(context, { skipLocalRateLimit: true });
    } else {
      yamlDecision = this.evaluate(context);
    }
    return resolvePolicyPrecedence(opaDecision, yamlDecision);
  }

  evaluate(context: CallContext, options?: { skipLocalRateLimit?: boolean }): PolicyDecision {
    // ── v1.2: Payload normalization (before regex evaluation) ──
    const normalizedArgs = context.arguments
      ? this.normalizer.normalizeJsonValue(context.arguments) as Record<string, unknown>
      : {};
    const normalizedContext: CallContext = {
      ...context,
      arguments: normalizedArgs,
    };

    // ── v1.2: Semantic shell analysis on argument strings ──
    const argsStr = JSON.stringify(normalizedArgs);
    const shellRisk: CommandRisk = argsStr.length > 0
      ? this.shellTokenizer.analyzeRisk(this.shellTokenizer.tokenize(argsStr).commands)
      : { hasCommandSubstitution: false, hasPipes: false, hasRedirects: false, hasLogicalChains: false, dangerousCommands: [], shellMetacharacters: [] };

    // Semantic shell analysis runs once per request (not per rule)
    const semanticDecision = this.evaluateSemanticShell(shellRisk, context.toolName);
    if (semanticDecision) return semanticDecision;

    const semanticAbuse = evaluateSemanticGuards(normalizedContext);
    if (semanticAbuse) {
      return { ...semanticAbuse, action: this.resolveAction(semanticAbuse.action) };
    }

    let permittedByAllowlist = false;
    for (const rule of this.rules) {
      if (rule.tools?.allow?.length && rule.tools.allow.includes(normalizedContext.toolName)) {
        permittedByAllowlist = true;
      }
      const decision = this.evaluateRule(rule, normalizedContext, { argsStr }, options?.skipLocalRateLimit);
      if (decision) return decision;
    }

    if (permittedByAllowlist) {
      return {
        action: 'pass',
        rule: 'allowlist',
        reason: `Tool '${normalizedContext.toolName}' is allowlisted and passed policy checks`,
      };
    }

    // GAP 14: default_action when no rule matches — omit for fail-open (rule-only policies);
    // set explicitly to 'block' in default-policy.yaml for fail-closed production posture.
    const defaultAction = this.config.policy.default_action ?? 'pass';
    return { action: this.resolveAction(defaultAction), rule: 'default', reason: `No matching rule — applying default_action: ${defaultAction}` };
  }

  /** Global semantic shell guard — evaluated once before rule iteration */
  private evaluateSemanticShell(shellRisk: CommandRisk, toolName: string): PolicyDecision | null {
    if (this.config.policy.semantic_shell === false) return null;

    if (shellRisk.hasCommandSubstitution) {
      Logger.info(`[policy] Semantic: command substitution detected in '${toolName}' arguments`);
      return {
        action: this.resolveAction('block'),
        rule: 'semantic-shell-guard',
        reason: 'Semantic: shell command substitution detected in arguments',
      };
    }

    if (shellRisk.dangerousCommands.length > 0) {
      Logger.info(`[policy] Semantic: dangerous commands [${shellRisk.dangerousCommands.join(', ')}] in '${toolName}' arguments`);
      return {
        action: this.resolveAction('block'),
        rule: 'semantic-shell-guard',
        reason: `Semantic: dangerous shell commands detected: [${shellRisk.dangerousCommands.join(', ')}]`,
      };
    }

    if (shellRisk.hasPipes && shellRisk.hasCommandSubstitution) {
      return {
        action: this.resolveAction('block'),
        rule: 'semantic-shell-guard',
        reason: 'Semantic: pipe chain with command substitution',
      };
    }

    return null;
  }

  private evaluateRule(
    rule: PolicyConfig['policy']['rules'][number],
    ctx: CallContext,
    analysis: { argsStr: string },
    skipLocalRateLimit = false,
  ): PolicyDecision | null {
    // Tool allowlist/denylist
    if (rule.tools) {
      if (rule.tools.allow && rule.tools.allow.length > 0) {
        if (rule.tools.allow.includes(ctx.toolName)) {
          // Allowed tool — keep evaluating pattern/deny/rate rules below.
          return null;
        }
        return { action: this.resolveAction(rule.action), rule: rule.name, reason: `Tool '${ctx.toolName}' not in allowlist: [${rule.tools.allow.join(', ')}]` };
      }
      if (rule.tools.deny && rule.tools.deny.length > 0) {
        if (rule.tools.deny.includes(ctx.toolName)) {
          return { action: this.resolveAction(rule.action), rule: rule.name, reason: `Tool '${ctx.toolName}' is explicitly denied` };
        }
      }
    }

    // v2.2: Tool category matching (e.g., destructive operations)
    if (rule.toolCategories?.deny) {
      const toolLower = ctx.toolName.toLowerCase();
      const matchesCategory = rule.toolCategories.deny.some(
        (cat) => toolLower.includes(cat.toLowerCase())
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

    // v2.2: Argument-level field patterns — uses pre-compiled regexes, recursive leaf walk
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

    // v1.2: Malicious pattern detection — uses pre-compiled regexes
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

    // Max tokens per call
    if (rule.maxTokens && ctx.requestTokens > rule.maxTokens) {
      return { action: this.resolveAction(rule.action), rule: rule.name, reason: `Token count ${ctx.requestTokens} exceeds max ${rule.maxTokens}` };
    }

    // v0.5.1: RBAC — scope and client_id constraints
    if (rule.rbac) {
      const identity = ctx.agentIdentity;
      if (!identity) {
        return { action: this.resolveAction(rule.action), rule: rule.name, reason: `RBAC rule '${rule.name}' requires agent identity but none provided` };
      }
      if (rule.rbac.scopes && rule.rbac.scopes.length > 0) {
        const agentScopes = identity.scopes || [];
        const hasScope = rule.rbac.scopes.some(s => agentScopes.includes(s));
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
    }

    // Rate limiting (LRU-backed, prevents memory leaks) — skipped when Redis cluster limiter is active
    if (rule.maxCallsPerMinute && !skipLocalRateLimit) {
      const key = `${ctx.serverName}:${ctx.toolName}`;
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

  /**
   * v2.5: Response inspection — scan tool RESPONSES for prompt injection and data exfiltration.
   * Unlike request evaluation, response inspection is informational (warn, not block)
   * since blocking a response mid-stream would corrupt the JSON-RPC state.
   */
  private static RESPONSE_INJECTION_PATTERNS: RegExp[] = [
    /(?:ignore|disregard|forget)\s+(?:previous|all|above|your)\s+(?:instructions?|training|rules|constraints)/i,
    /(?:system|assistant):\s*(?:you\s+are|your\s+new\s+role|override)/i,
    /\b(jailbreak|DAN|developer\s*mode)\b/i,
    /now\s+act\s+as/i,
    /<\|(?:endoftext|im_start|im_end)\|>/,
    /\[\[INJECT\]\]/i,
    /\b(I\s*gnore|D\s*isregard|F\s*orget)\s+(?:previous|all|your)\s+(?:instructions?|training)/i,
  ];

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
    const detections: string[] = [];

    if (responseBody == null || typeof responseBody !== 'string') {
      return { clean: true, detections };
    }

    for (const pattern of PolicyEngine.RESPONSE_INJECTION_PATTERNS) {
      if (pattern.test(responseBody)) {
        detections.push(`Prompt injection: response matches '${pattern.source}'`);
      }
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

  /** Expose the shell tokenizer for testing */
  getShellTokenizer(): ShellTokenizer {
    return this.shellTokenizer;
  }
}