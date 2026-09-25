export class ToolCallHookRegistry {
    beforeHooks = [];
    afterHooks = [];
    errorHooks = [];
    registerBefore(hook) {
        if (this.beforeHooks.some(h => h.name === hook.name)) {
            throw new Error(`Before hook "${hook.name}" already registered`);
        }
        this.beforeHooks.push({ ...hook, enabled: true });
        this.beforeHooks.sort((a, b) => a.priority - b.priority);
    }
    registerAfter(hook) {
        if (this.afterHooks.some(h => h.name === hook.name)) {
            throw new Error(`After hook "${hook.name}" already registered`);
        }
        this.afterHooks.push({ ...hook, enabled: true });
        this.afterHooks.sort((a, b) => a.priority - b.priority);
    }
    registerError(hook) {
        if (this.errorHooks.some(h => h.name === hook.name)) {
            throw new Error(`Error hook "${hook.name}" already registered`);
        }
        this.errorHooks.push({ ...hook, enabled: true });
    }
    enableHook(name) {
        this.setHookEnabled(name, true);
    }
    disableHook(name) {
        this.setHookEnabled(name, false);
    }
    setHookEnabled(name, enabled) {
        for (const hooks of [this.beforeHooks, this.afterHooks, this.errorHooks]) {
            const hook = hooks.find(h => h.name === name);
            if (hook) {
                hook.enabled = enabled;
                return;
            }
        }
    }
    async runBeforeHooks(context) {
        let modifiedArgs;
        for (const hook of this.beforeHooks) {
            if (!hook.enabled)
                continue;
            try {
                const result = await hook.beforeToolCall(context);
                if (!result.allowed) {
                    return { allowed: false, reason: result.reason || `Blocked by hook "${hook.name}"` };
                }
                if (result.modifiedArgs) {
                    modifiedArgs = { ...(modifiedArgs || context.tool.arguments), ...result.modifiedArgs };
                }
            }
            catch (err) {
                console.error(`[hooks] Before hook "${hook.name}" threw:`, err);
            }
        }
        return { allowed: true, args: modifiedArgs };
    }
    async runAfterHooks(context, result) {
        let modifiedResult = result.output;
        for (const hook of this.afterHooks) {
            if (!hook.enabled)
                continue;
            try {
                const hookResult = await hook.afterToolCall(context, result);
                if (!hookResult.allowed) {
                    return { allowed: false, reason: hookResult.reason || `Response blocked by hook "${hook.name}"` };
                }
                if (hookResult.modifiedResult !== undefined) {
                    modifiedResult = hookResult.modifiedResult;
                }
            }
            catch (err) {
                console.error(`[hooks] After hook "${hook.name}" threw:`, err);
            }
        }
        return { allowed: true, result: modifiedResult };
    }
    async runErrorHooks(context, error) {
        for (const hook of this.errorHooks) {
            if (!hook.enabled)
                continue;
            try {
                await hook.onError(context, error);
            }
            catch (err) {
                console.error(`[hooks] Error hook "${hook.name}" threw:`, err);
            }
        }
    }
    listHooks() {
        const hooks = [];
        for (const h of this.beforeHooks)
            hooks.push({ name: h.name, type: 'before', enabled: h.enabled, priority: h.priority });
        for (const h of this.afterHooks)
            hooks.push({ name: h.name, type: 'after', enabled: h.enabled, priority: h.priority });
        for (const h of this.errorHooks)
            hooks.push({ name: h.name, type: 'error', enabled: h.enabled });
        return hooks;
    }
}
export function createRateLimitHook(options) {
    const callCounts = new Map();
    return {
        name: 'builtin-rate-limit',
        priority: 10,
        async beforeToolCall(context) {
            const key = options.perUser && context.identity
                ? `${context.tool.serverName}:${context.tool.toolName}:${context.identity.sub}`
                : `${context.tool.serverName}:${context.tool.toolName}`;
            const now = Date.now();
            let entry = callCounts.get(key);
            if (!entry || now > entry.resetAt) {
                entry = { count: 1, resetAt: now + 60_000 };
                callCounts.set(key, entry);
                return { allowed: true };
            }
            entry.count++;
            if (entry.count > options.maxCallsPerMinute) {
                return { allowed: false, reason: `Rate limit exceeded: ${options.maxCallsPerMinute} calls/min for ${key}` };
            }
            return { allowed: true };
        },
    };
}
export function createPiiRedactionHook(fields) {
    const PII_PATTERNS = [
        { name: 'ssn-us', regex: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '***-**-****' },
        { name: 'credit-card', regex: /\b(?:\d[ -]*?){13,16}\b/g, replacement: '****-****-****-****' },
        { name: 'email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '***@***.***' },
        { name: 'ipv4', regex: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g, replacement: '***.***.***.***' },
        { name: 'phone-us', regex: /\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: '***-***-****' },
        { name: 'api-key-pattern', regex: /(?:sk|api[_-]?key|token|secret|password|auth)[=:]\s*['"]?[A-Za-z0-9+/._-]{20,}['"]?/gi, replacement: '***REDACTED***' },
    ];
    return {
        name: 'builtin-pii-redaction',
        priority: 20,
        async afterToolCall(context, result) {
            if (!result.output)
                return { allowed: true };
            function deepScan(obj) {
                if (typeof obj === 'string') {
                    let cleaned = obj;
                    for (const p of PII_PATTERNS)
                        cleaned = cleaned.replace(p.regex, p.replacement);
                    for (const field of fields) {
                        const fp = new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`, 'gi');
                        cleaned = cleaned.replace(fp, `"${field}":"***REDACTED***"`);
                    }
                    return cleaned;
                }
                if (Array.isArray(obj))
                    return obj.map(deepScan);
                if (obj && typeof obj === 'object') {
                    const out = {};
                    for (const [k, v] of Object.entries(obj)) {
                        out[k] = deepScan(v);
                    }
                    return out;
                }
                return obj;
            }
            const outputStr = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
            if (typeof result.output === 'object' && result.output !== null && !Array.isArray(result.output)) {
                return { allowed: true, modifiedResult: deepScan(result.output) };
            }
            let cleaned = outputStr;
            for (const pattern of PII_PATTERNS) {
                cleaned = cleaned.replace(pattern.regex, pattern.replacement);
            }
            for (const field of fields) {
                const pattern = new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`, 'gi');
                cleaned = cleaned.replace(pattern, `"${field}":"***REDACTED***"`);
            }
            if (typeof result.output === 'string') {
                return { allowed: true, modifiedResult: cleaned };
            }
            try {
                return { allowed: true, modifiedResult: JSON.parse(cleaned) };
            }
            catch {
                return { allowed: true, modifiedResult: result.output };
            }
        },
    };
}
export function createSensitivePathGuard(allowedPaths, deniedPaths) {
    return {
        name: 'builtin-sensitive-path-guard',
        priority: 5,
        async beforeToolCall(context) {
            const args = context.tool.arguments;
            for (const pathKey of ['path', 'file', 'directory', 'source', 'target']) {
                const pathValue = args[pathKey];
                if (typeof pathValue !== 'string')
                    continue;
                for (const denied of deniedPaths) {
                    const regex = new RegExp(denied.replace(/\*/g, '.*'));
                    if (regex.test(pathValue)) {
                        return { allowed: false, reason: `Access to path matching "${denied}" denied: ${pathValue}` };
                    }
                }
                if (allowedPaths.length > 0) {
                    const isAllowed = allowedPaths.some(p => {
                        const regex = new RegExp(p.replace(/\*/g, '.*'));
                        return regex.test(pathValue);
                    });
                    if (!isAllowed) {
                        return { allowed: false, reason: `Path not in allowed list: ${pathValue}` };
                    }
                }
            }
            return { allowed: true };
        },
    };
}
// ═══════════════════════════════════════════════════════════════════════════
// Pre-built Hook Library
// ═══════════════════════════════════════════════════════════════════════════
export function createSlackNotifierHook(webhookUrl) {
    return {
        name: 'builtin-slack-notifier',
        version: '1.0',
        priority: 90,
        async beforeToolCall(context) {
            try {
                await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `:shield: Mastyf — ${context.tool.serverName}/${context.tool.toolName} by ${context.identity?.sub || 'anonymous'}` }), signal: AbortSignal.timeout(3000) });
            }
            catch { /* best-effort */ }
            return { allowed: true };
        },
    };
}
export function createSlackBlockNotifierHook(webhookUrl) {
    return {
        name: 'builtin-slack-block-notifier',
        version: '1.0',
        priority: 90,
        async afterToolCall(context, result) {
            if (!result.success)
                return { allowed: true };
            try {
                await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `:white_check_mark: ${context.tool.toolName} completed in ${result.durationMs}ms` }), signal: AbortSignal.timeout(3000) });
            }
            catch { /* best-effort */ }
            return { allowed: true };
        },
    };
}
export function createPagerDutyHook(routingKey) {
    return {
        name: 'builtin-pagerduty-alert',
        version: '1.0',
        priority: 91,
        async afterToolCall(_ctx, result) {
            if (!result.success) {
                try {
                    await fetch('https://events.pagerduty.com/v2/enqueue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ routing_key: routingKey, event_action: 'trigger', payload: { summary: `Tool call failed: ${_ctx.tool.toolName}`, source: 'mastyf-ai', severity: 'error' } }), signal: AbortSignal.timeout(5000) });
                }
                catch { /* best-effort */ }
            }
            return { allowed: true };
        },
    };
}
export function createTimeBasedAccessHook(config) {
    return {
        name: 'builtin-time-based-access',
        version: '1.0',
        priority: 4,
        async beforeToolCall(_ctx) {
            const now = new Date();
            const h = now.getUTCHours();
            const d = now.getUTCDay();
            if (config.deniedDays?.includes(d)) {
                const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                return { allowed: false, reason: `Access denied on ${names[d]}s` };
            }
            if (config.allowedHours) {
                const [s, e] = config.allowedHours;
                if (h < s || h >= e)
                    return { allowed: false, reason: `Outside hours ${s}:00-${e}:00 UTC` };
            }
            return { allowed: true };
        },
    };
}
export function createGeoFencingHook(allowedRegions) {
    return {
        name: 'builtin-geo-fencing',
        version: '1.0',
        priority: 4,
        async beforeToolCall(context) {
            const region = context.hookState.get('geoRegion') || process.env.MASTYF_AI_REGION;
            if (!region || allowedRegions.length === 0)
                return { allowed: true };
            if (!allowedRegions.map(r => r.toUpperCase()).includes(region.toUpperCase()))
                return { allowed: false, reason: `Region "${region}" not allowed` };
            return { allowed: true };
        },
    };
}
export function createCustomHook(name, code, type, priority = 50) {
    try {
        const fn = new Function('context', 'result', code);
        if (type === 'before')
            return { name, version: 'custom', priority, async beforeToolCall(ctx) { return fn(ctx, undefined); } };
        if (type === 'after')
            return { name, version: 'custom', priority, async afterToolCall(ctx, r) { return fn(ctx, r); } };
        return { name, version: 'custom', async onError(ctx, err) { fn(ctx, err); } };
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=tool-call-hooks.js.map