import { Logger } from '../utils/logger.js';
import { getNormalizer } from '../utils/payload-normalizer.js';
import { setActiveEntropyPolicy } from './entropy-policy.js';
import { isFpWhitelisted } from '../ai/fp-whitelist.js';
import { ShellTokenizer } from './shell-tokenizer.js';
import { resolvePolicyPrecedence } from './policy-precedence.js';
import { getCachedPolicyDecision, isPolicyEvalCacheEnabled, policyEvalCacheKey, setCachedPolicyDecision, shouldCachePolicyDecision, } from './policy-eval-cache.js';
import { walkStringLeaves } from './arg-leaf-walker.js';
import { SYNC_POLICY_STRATEGIES, evaluateIdempotency, evaluateRedisRateLimit, evaluateRedisTokenBudget, opaStrategy, runShadowPolicy, yamlRulesStrategy, } from './strategies/index.js';
import { compilePolicyRegex, safeRegexTest, UnsafePolicyRegexError } from './regex-compile.js';
import { MAX_REGEX_INPUT_CHARS } from '../utils/eval-bounds.js';
import { evaluateResponseDlp, responseDlpToLegacyDetections, } from './response-dlp.js';
import { waitPolicyTimingEnvelopeAsync, waitPolicyTimingEnvelopeSync, } from './policy-timing-envelope.js';
import { KeyedAsyncLock } from '../utils/keyed-async-lock.js';
import { sharedRateLimitStore } from './rate-limit-store.js';
/**
 * Policy Engine — evaluates every intercepted tools/call against configured rules.
 * Supports three modes: audit (passive), warn (flag only), block (active enforcement).
 *
 * v1.2: Integrated payload normalization and semantic shell analysis layers
 * v2.1: Replaced Map with LRUCache to prevent memory leaks under sustained load
 * v2.9: Strategy-pattern pipeline under src/policy/strategies/
 */
export class PolicyEngine {
    rules;
    mode;
    config;
    get callCounters() {
        return sharedRateLimitStore.call();
    }
    get burstCounters() {
        return sharedRateLimitStore.burst();
    }
    normalizer;
    shellTokenizer = new ShellTokenizer();
    compiledPatterns = new Map();
    compiledArgPatterns = new Map();
    policyEvalLock = new KeyedAsyncLock();
    compiledRbacClientIds = new Map();
    constructor(config) {
        this.rules = config.policy.rules;
        this.mode = config.policy.mode;
        this.config = config;
        this.normalizer = getNormalizer(config.policy.unicode_strict !== false);
        setActiveEntropyPolicy(config);
        this.compilePatterns();
        this.compileRbacClientIds();
    }
    compilePatterns() {
        for (const rule of this.rules) {
            if (rule.patterns?.length) {
                try {
                    const patternFlags = rule.name === 'block-encoding-evasion' ? '' : 'i';
                    const compiled = rule.patterns.map((p) => compilePolicyRegex(p, patternFlags));
                    this.compiledPatterns.set(rule.name, [
                        ...(this.compiledPatterns.get(rule.name) || []),
                        { compiled, rule },
                    ]);
                }
                catch (err) {
                    if (err instanceof UnsafePolicyRegexError)
                        throw err;
                    Logger.warn(`Policy: invalid regex in rule '${rule.name}' patterns — skipping pre-compilation`);
                }
            }
            if (rule.argPatterns?.length) {
                for (const ap of rule.argPatterns) {
                    try {
                        const argFlags = rule.name === 'block-encoding-evasion' ? '' : 'i';
                        const compiled = ap.patterns.map((p) => compilePolicyRegex(p, argFlags));
                        this.compiledArgPatterns.set(rule.name, [
                            ...(this.compiledArgPatterns.get(rule.name) || []),
                            { field: ap.field, compiled, rule },
                        ]);
                    }
                    catch (err) {
                        if (err instanceof UnsafePolicyRegexError)
                            throw err;
                        Logger.warn(`Policy: invalid regex in rule '${rule.name}' argPatterns — skipping pre-compilation`);
                    }
                }
            }
        }
    }
    compileRbacClientIds() {
        for (const rule of this.rules) {
            if (rule.rbac?.clientIds?.length) {
                const compiled = [];
                for (const pattern of rule.rbac.clientIds) {
                    try {
                        compiled.push(compilePolicyRegex(pattern, ''));
                    }
                    catch (err) {
                        if (err instanceof UnsafePolicyRegexError)
                            throw err;
                        Logger.warn(`Policy: invalid clientId regex in rule '${rule.name}': ${pattern} — skipping`);
                    }
                }
                this.compiledRbacClientIds.set(rule.name, compiled);
            }
        }
    }
    extractLeafValues(obj) {
        return walkStringLeaves(obj).map((l) => l.value);
    }
    /**
     * Anti-evasion token budget: use reported count and UTF-8 byte inflation from arguments.
     */
    effectiveRequestTokens(ctx) {
        let inflated = 0;
        let leafChars = 0;
        if (ctx.arguments) {
            for (const { value } of walkStringLeaves(ctx.arguments)) {
                leafChars += value.length;
                inflated += Buffer.byteLength(value, 'utf8');
                for (const ch of value) {
                    const cp = ch.codePointAt(0);
                    if (cp > 0x7f)
                        inflated += 2;
                }
            }
        }
        const byteEstimate = Math.ceil(inflated / 4);
        const charEstimate = Math.ceil(leafChars / 2);
        // Context-stuffing: large single-field blobs exceed budget even when byte/2 estimates are low.
        const stuffingEstimate = leafChars >= 40_000 ? leafChars : 0;
        return Math.max(ctx.requestTokens, byteEstimate, charEstimate, stuffingEstimate);
    }
    policyEvalLockKey(ctx) {
        const tenant = ctx.tenantId || process.env['MASTYF_AI_TENANT_ID'] || 'default';
        const clientId = ctx.agentIdentity?.clientId || ctx.agentIdentity?.sub || 'anon';
        return `${tenant}:${ctx.serverName}:${ctx.toolName}:${clientId}`;
    }
    buildDeps() {
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
            evaluateRule: (rule, ctx, analysis, skip) => this.evaluateRule(rule, ctx, analysis, skip),
        };
    }
    isOpaEnabled() {
        if (!process.env['OPA_URL'])
            return false;
        if (this.config.policy.opa === false)
            return false;
        return this.config.policy.opa === true || process.env['MASTYF_AI_OPA_ENABLED'] === 'true';
    }
    async evaluateAsync(context) {
        const startedAt = Date.now();
        try {
            runShadowPolicy(context);
            const idempotencyDecision = await evaluateIdempotency(context, this.mode);
            if (idempotencyDecision)
                return idempotencyDecision;
            const deps = this.buildDeps();
            const opaDecision = this.isOpaEnabled()
                ? await opaStrategy.evaluateAsync(context, deps)
                : null;
            const { decision: rateDecision, skipLocalRateLimit } = await evaluateRedisRateLimit(context, deps);
            if (rateDecision) {
                return resolvePolicyPrecedence(opaDecision, rateDecision);
            }
            const { decision: tokenBudgetDecision } = await evaluateRedisTokenBudget(context, deps);
            if (tokenBudgetDecision) {
                return resolvePolicyPrecedence(opaDecision, tokenBudgetDecision);
            }
            if (isPolicyEvalCacheEnabled()) {
                const cacheKey = policyEvalCacheKey(context);
                const cached = await getCachedPolicyDecision(cacheKey, context.tenantId);
                if (cached)
                    return resolvePolicyPrecedence(opaDecision, cached);
            }
            const evalKey = this.policyEvalLockKey(context);
            const yamlDecision = await this.policyEvalLock.runExclusive(evalKey, () => this.evaluate(context, {
                skipLocalRateLimit,
                applyTimingEnvelope: false,
            }));
            const finalDecision = resolvePolicyPrecedence(opaDecision, yamlDecision);
            const matchedRule = this.config.policy.rules.find((r) => r.name === finalDecision.rule);
            if (isPolicyEvalCacheEnabled()
                && shouldCachePolicyDecision(finalDecision, { ruleCacheable: matchedRule?.cacheable })) {
                await setCachedPolicyDecision(policyEvalCacheKey(context), finalDecision);
            }
            return finalDecision;
        }
        finally {
            await waitPolicyTimingEnvelopeAsync(startedAt);
        }
    }
    /** Clear in-memory per-minute call counters (harness / isolated rate-limit suites). */
    resetRateCounters() {
        this.callCounters.clear();
        this.burstCounters.clear();
    }
    evaluate(context, options) {
        const startedAt = Date.now();
        const normalizedArgs = context.arguments
            ? this.normalizer.normalizeJsonValue(context.arguments)
            : {};
        const normalizedContext = {
            ...context,
            arguments: normalizedArgs,
        };
        const argsStr = JSON.stringify(normalizedArgs);
        const syncCtx = {
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
            if (decision) {
                if (options?.applyTimingEnvelope !== false) {
                    waitPolicyTimingEnvelopeSync(startedAt);
                }
                return decision;
            }
        }
        const defaultAction = this.config.policy.default_action ?? 'pass';
        const defaultDecision = {
            action: this.resolveAction(defaultAction),
            rule: 'default',
            reason: `No matching rule — applying default_action: ${defaultAction}`,
        };
        if (options?.applyTimingEnvelope !== false) {
            waitPolicyTimingEnvelopeSync(startedAt);
        }
        return defaultDecision;
    }
    evaluateRule(rule, ctx, analysis, skipLocalRateLimit = false) {
        if (rule.enabled === false)
            return null;
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
            const matchesCategory = rule.toolCategories.deny.some((cat) => toolLower.includes(cat.toLowerCase()));
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
                if (r.name !== rule.name)
                    continue;
                const values = field === '*'
                    ? this.extractLeafValues(ctx.arguments)
                    : (ctx.arguments[field] !== undefined ? this.extractLeafValues(ctx.arguments[field]) : []);
                for (const value of values) {
                    if (rule.name === 'block-encoding-evasion' &&
                        value.length >= 32 &&
                        /^(.)\1+$/.test(value)) {
                        continue;
                    }
                    for (const regex of compiled) {
                        if (safeRegexTest(regex, value, MAX_REGEX_INPUT_CHARS)) {
                            const patternKey = `${field}:${regex.source}`;
                            if (isFpWhitelisted(rule.name, patternKey))
                                continue;
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
                if (r.name !== rule.name)
                    continue;
                for (const regex of compiled) {
                    if (rule.name === 'block-encoding-evasion' &&
                        this.extractLeafValues(ctx.arguments).every((v) => v.length < 32 || /^(.)\1+$/.test(v))) {
                        continue;
                    }
                    if (safeRegexTest(regex, analysis.argsStr, MAX_REGEX_INPUT_CHARS)) {
                        if (isFpWhitelisted(rule.name, regex.source))
                            continue;
                        return { action: this.resolveAction(rule.action), rule: rule.name, reason: `Argument pattern matched in tool call (normalized)` };
                    }
                }
            }
        }
        if (rule.maxTokens) {
            const tokenCtx = analysis.raw ?? ctx;
            const effectiveTokens = this.effectiveRequestTokens(tokenCtx);
            if (effectiveTokens > rule.maxTokens) {
                return {
                    action: this.resolveAction(rule.action),
                    rule: rule.name,
                    reason: `Token count ${effectiveTokens} exceeds max ${rule.maxTokens}`,
                };
            }
        }
        if (rule.rbac) {
            const identity = ctx.agentIdentity;
            if (!identity) {
                return { action: this.resolveAction(rule.action), rule: rule.name, reason: `RBAC rule '${rule.name}' requires agent identity but none provided` };
            }
            if (rule.rbac.scopes && rule.rbac.scopes.length > 0) {
                const agentScopes = (identity.scopes || []).map((s) => s.toLowerCase());
                const required = rule.rbac.scopes.map((s) => s.toLowerCase());
                const matchMode = rule.rbac.scopeMatch === 'all' ? 'all' : 'any';
                const hasScope = matchMode === 'all'
                    ? required.every((r) => agentScopes.includes(r))
                    : required.some((r) => agentScopes.includes(r));
                if (!hasScope) {
                    return { action: this.resolveAction(rule.action), rule: rule.name, reason: `Agent '${identity.sub}' missing required scope. Need one of: [${rule.rbac.scopes.join(', ')}], have: [${agentScopes.join(', ') || 'none'}]` };
                }
            }
            if (rule.rbac.clientIds && rule.rbac.clientIds.length > 0) {
                const clientId = identity.clientId || '';
                const compiledIds = this.compiledRbacClientIds.get(rule.name) || [];
                const matches = compiledIds.some(regex => safeRegexTest(regex, clientId, MAX_REGEX_INPUT_CHARS));
                if (!matches) {
                    return { action: this.resolveAction(rule.action), rule: rule.name, reason: `Client ID '${clientId}' not allowed. Allowed patterns: [${rule.rbac.clientIds.join(', ')}]` };
                }
            }
            if (rule.rbac.tenants && rule.rbac.tenants.length > 0) {
                const requestTenant = ctx.tenantId || process.env['MASTYF_AI_TENANT_ID'] || 'default';
                if (!rule.rbac.tenants.includes(requestTenant)) {
                    return {
                        action: this.resolveAction(rule.action),
                        rule: rule.name,
                        reason: `Tenant '${requestTenant}' not allowed for rule '${rule.name}'. Allowed: [${rule.rbac.tenants.join(', ')}]`,
                    };
                }
            }
        }
        if (!skipLocalRateLimit) {
            const tenant = ctx.tenantId || process.env['MASTYF_AI_TENANT_ID'] || 'default';
            const clientId = ctx.agentIdentity?.clientId || ctx.agentIdentity?.sub;
            const key = clientId
                ? `${tenant}:${ctx.serverName}:${ctx.toolName}:${clientId}`
                : `${tenant}:${ctx.serverName}:${ctx.toolName}`;
            const now = Date.now();
            if (rule.maxCallsPer10Seconds) {
                let burst = this.burstCounters.get(key);
                if (!burst || now > burst.resetAt) {
                    burst = { count: 1, resetAt: now + 10_000 };
                }
                else {
                    burst.count++;
                }
                this.burstCounters.set(key, burst);
                if (burst.count > rule.maxCallsPer10Seconds) {
                    return {
                        action: this.resolveAction(rule.action),
                        rule: rule.name,
                        reason: `Burst rate limit exceeded: ${burst.count}/${rule.maxCallsPer10Seconds} calls per 10s`,
                    };
                }
            }
            if (rule.maxCallsPerMinute) {
                let counter = this.callCounters.get(key);
                if (!counter || now > counter.resetAt) {
                    counter = { count: 1, resetAt: now + 60000 };
                }
                else {
                    counter.count++;
                }
                this.callCounters.set(key, counter);
                if (counter.count > rule.maxCallsPerMinute) {
                    return {
                        action: this.resolveAction(rule.action),
                        rule: rule.name,
                        reason: `Rate limit exceeded: ${counter.count}/${rule.maxCallsPerMinute} calls per minute`,
                    };
                }
            }
        }
        return null;
    }
    resolveAction(ruleAction) {
        if (this.mode === 'audit')
            return 'pass';
        if (this.mode === 'warn' && ruleAction === 'block')
            return 'flag';
        return ruleAction;
    }
    getMode() {
        return this.mode;
    }
    getRules() {
        return this.rules;
    }
    getRuleCount() {
        return this.rules.length;
    }
    evaluateResponse(toolName, serverName, responseBody) {
        const result = evaluateResponseDlp(toolName, serverName, responseBody);
        return {
            clean: result.clean,
            detections: responseDlpToLegacyDetections(result),
            hasCritical: result.hasCritical,
            hasHigh: result.hasHigh,
        };
    }
    getShellTokenizer() {
        return this.shellTokenizer;
    }
}
//# sourceMappingURL=policy-engine.js.map