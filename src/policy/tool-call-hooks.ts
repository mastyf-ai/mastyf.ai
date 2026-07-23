import type { CallContext, PolicyDecision } from '../policy/policy-types.js';
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
  beforeToolCall(context: HookContext): Promise<{ allowed: boolean; reason?: string; modifiedArgs?: Record<string, unknown> }>;
}

export interface AfterToolCallHook {
  name: string;
  version?: string;
  priority: number;
  afterToolCall(context: HookContext, result: ToolCallResult): Promise<{ allowed: boolean; reason?: string; modifiedResult?: unknown }>;
}

export interface ErrorHook {
  name: string;
  version?: string;
  onError(context: HookContext, error: Error): Promise<void>;
}

interface RegisteredBeforeHook extends BeforeToolCallHook {
  enabled: boolean;
}

interface RegisteredAfterHook extends AfterToolCallHook {
  enabled: boolean;
}

interface RegisteredErrorHook extends ErrorHook {
  enabled: boolean;
}

export class ToolCallHookRegistry {
  private beforeHooks: RegisteredBeforeHook[] = [];
  private afterHooks: RegisteredAfterHook[] = [];
  private errorHooks: RegisteredErrorHook[] = [];

  registerBefore(hook: BeforeToolCallHook): void {
    if (this.beforeHooks.some(h => h.name === hook.name)) {
      throw new Error(`Before hook "${hook.name}" already registered`);
    }
    this.beforeHooks.push({ ...hook, enabled: true });
    this.beforeHooks.sort((a, b) => a.priority - b.priority);
  }

  registerAfter(hook: AfterToolCallHook): void {
    if (this.afterHooks.some(h => h.name === hook.name)) {
      throw new Error(`After hook "${hook.name}" already registered`);
    }
    this.afterHooks.push({ ...hook, enabled: true });
    this.afterHooks.sort((a, b) => a.priority - b.priority);
  }

  registerError(hook: ErrorHook): void {
    if (this.errorHooks.some(h => h.name === hook.name)) {
      throw new Error(`Error hook "${hook.name}" already registered`);
    }
    this.errorHooks.push({ ...hook, enabled: true });
  }

  enableHook(name: string): void {
    this.setHookEnabled(name, true);
  }

  disableHook(name: string): void {
    this.setHookEnabled(name, false);
  }

  private setHookEnabled(name: string, enabled: boolean): void {
    for (const hooks of [this.beforeHooks, this.afterHooks, this.errorHooks]) {
      const hook = hooks.find(h => h.name === name);
      if (hook) {
        (hook as any).enabled = enabled;
        return;
      }
    }
  }

  async runBeforeHooks(context: HookContext): Promise<{ allowed: boolean; reason?: string; args?: Record<string, unknown> }> {
    let modifiedArgs: Record<string, unknown> | undefined;

    for (const hook of this.beforeHooks) {
      if (!hook.enabled) continue;
      try {
        const result = await hook.beforeToolCall(context);
        if (!result.allowed) {
          return { allowed: false, reason: result.reason || `Blocked by hook "${hook.name}"` };
        }
        if (result.modifiedArgs) {
          modifiedArgs = { ...(modifiedArgs || context.tool.arguments), ...result.modifiedArgs };
        }
      } catch (err) {
        console.error(`[hooks] Before hook "${hook.name}" threw:`, err);
      }
    }

    return { allowed: true, args: modifiedArgs };
  }

  async runAfterHooks(context: HookContext, result: ToolCallResult): Promise<{ allowed: boolean; reason?: string; result?: unknown }> {
    let modifiedResult: unknown = result.output;

    for (const hook of this.afterHooks) {
      if (!hook.enabled) continue;
      try {
        const hookResult = await hook.afterToolCall(context, result);
        if (!hookResult.allowed) {
          return { allowed: false, reason: hookResult.reason || `Response blocked by hook "${hook.name}"` };
        }
        if (hookResult.modifiedResult !== undefined) {
          modifiedResult = hookResult.modifiedResult;
        }
      } catch (err) {
        console.error(`[hooks] After hook "${hook.name}" threw:`, err);
      }
    }

    return { allowed: true, result: modifiedResult };
  }

  async runErrorHooks(context: HookContext, error: Error): Promise<void> {
    for (const hook of this.errorHooks) {
      if (!hook.enabled) continue;
      try {
        await hook.onError(context, error);
      } catch (err) {
        console.error(`[hooks] Error hook "${hook.name}" threw:`, err);
      }
    }
  }

  listHooks(): { name: string; type: 'before' | 'after' | 'error'; enabled: boolean; priority?: number }[] {
    const hooks: { name: string; type: 'before' | 'after' | 'error'; enabled: boolean; priority?: number }[] = [];
    for (const h of this.beforeHooks) hooks.push({ name: h.name, type: 'before', enabled: h.enabled, priority: h.priority });
    for (const h of this.afterHooks) hooks.push({ name: h.name, type: 'after', enabled: h.enabled, priority: h.priority });
    for (const h of this.errorHooks) hooks.push({ name: h.name, type: 'error', enabled: h.enabled });
    return hooks;
  }
}

export function createRateLimitHook(options: { maxCallsPerMinute: number; perUser?: boolean }): BeforeToolCallHook {
  const callCounts = new Map<string, { count: number; resetAt: number }>();

  return {
    name: 'builtin-rate-limit',
    priority: 10,
    async beforeToolCall(context: HookContext): Promise<{ allowed: boolean; reason?: string; modifiedArgs?: Record<string, unknown> }> {
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

export function createPiiRedactionHook(fields: string[]): AfterToolCallHook {
  const PII_PATTERNS: Array<{ name: string; regex: RegExp; replacement: string }> = [
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
    async afterToolCall(context: HookContext, result: ToolCallResult): Promise<{ allowed: boolean; reason?: string; modifiedResult?: unknown }> {
      if (!result.output) return { allowed: true };

      function deepScan(obj: unknown): unknown {
        if (typeof obj === 'string') {
          let cleaned = obj;
          for (const p of PII_PATTERNS) cleaned = cleaned.replace(p.regex, p.replacement);
          for (const field of fields) {
            const fp = new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`, 'gi');
            cleaned = cleaned.replace(fp, `"${field}":"***REDACTED***"`);
          }
          return cleaned;
        }
        if (Array.isArray(obj)) return obj.map(deepScan);
        if (obj && typeof obj === 'object') {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
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
      } catch {
        return { allowed: true, modifiedResult: result.output };
      }
    },
  };
}

export function createSensitivePathGuard(allowedPaths: string[], deniedPaths: string[]): BeforeToolCallHook {
  return {
    name: 'builtin-sensitive-path-guard',
    priority: 5,
    async beforeToolCall(context: HookContext): Promise<{ allowed: boolean; reason?: string; modifiedArgs?: Record<string, unknown> }> {
      const args = context.tool.arguments;

      for (const pathKey of ['path', 'file', 'directory', 'source', 'target']) {
        const pathValue = args[pathKey];
        if (typeof pathValue !== 'string') continue;

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

export function createSlackNotifierHook(webhookUrl: string): BeforeToolCallHook {
  return {
    name: 'builtin-slack-notifier',
    version: '1.0',
    priority: 90,
    async beforeToolCall(context: HookContext): Promise<{ allowed: boolean; reason?: string }> {
      try { await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `:shield: Mastyf — ${context.tool.serverName}/${context.tool.toolName} by ${context.identity?.sub || 'anonymous'}` }), signal: AbortSignal.timeout(3000) }); } catch { /* best-effort */ }
      return { allowed: true };
    },
  };
}

export function createSlackBlockNotifierHook(webhookUrl: string): AfterToolCallHook {
  return {
    name: 'builtin-slack-block-notifier',
    version: '1.0',
    priority: 90,
    async afterToolCall(context: HookContext, result: ToolCallResult): Promise<{ allowed: boolean; reason?: string }> {
      if (!result.success) return { allowed: true };
      try { await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `:white_check_mark: ${context.tool.toolName} completed in ${result.durationMs}ms` }), signal: AbortSignal.timeout(3000) }); } catch { /* best-effort */ }
      return { allowed: true };
    },
  };
}

export function createPagerDutyHook(routingKey: string): AfterToolCallHook {
  return {
    name: 'builtin-pagerduty-alert',
    version: '1.0',
    priority: 91,
    async afterToolCall(_ctx: HookContext, result: ToolCallResult): Promise<{ allowed: boolean; reason?: string }> {
      if (!result.success) {
        try { await fetch('https://events.pagerduty.com/v2/enqueue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ routing_key: routingKey, event_action: 'trigger', payload: { summary: `Tool call failed: ${_ctx.tool.toolName}`, source: 'mastyf-ai', severity: 'error' } }), signal: AbortSignal.timeout(5000) }); } catch { /* best-effort */ }
      }
      return { allowed: true };
    },
  };
}

export function createTimeBasedAccessHook(config: { allowedHours?: [number, number]; deniedDays?: number[] }): BeforeToolCallHook {
  return {
    name: 'builtin-time-based-access',
    version: '1.0',
    priority: 4,
    async beforeToolCall(_ctx: HookContext): Promise<{ allowed: boolean; reason?: string }> {
      const now = new Date(); const h = now.getUTCHours(); const d = now.getUTCDay();
      if (config.deniedDays?.includes(d)) { const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; return { allowed: false, reason: `Access denied on ${names[d]}s` }; }
      if (config.allowedHours) { const [s,e] = config.allowedHours; if (h < s || h >= e) return { allowed: false, reason: `Outside hours ${s}:00-${e}:00 UTC` }; }
      return { allowed: true };
    },
  };
}

export function createGeoFencingHook(allowedRegions: string[]): BeforeToolCallHook {
  return {
    name: 'builtin-geo-fencing',
    version: '1.0',
    priority: 4,
    async beforeToolCall(context: HookContext): Promise<{ allowed: boolean; reason?: string }> {
      const region = (context.hookState.get('geoRegion') as string) || process.env.MASTYF_AI_REGION;
      if (!region || allowedRegions.length === 0) return { allowed: true };
      if (!allowedRegions.map(r => r.toUpperCase()).includes(region.toUpperCase())) return { allowed: false, reason: `Region "${region}" not allowed` };
      return { allowed: true };
    },
  };
}

export function createCustomHook(name: string, code: string, type: 'before' | 'after' | 'error', priority: number = 50): BeforeToolCallHook | AfterToolCallHook | ErrorHook | null {
  try {
    const fn = new Function('context', 'result', code);
    if (type === 'before') return { name, version: 'custom', priority, async beforeToolCall(ctx: HookContext) { return fn(ctx, undefined); } } as BeforeToolCallHook;
    if (type === 'after') return { name, version: 'custom', priority, async afterToolCall(ctx: HookContext, r: ToolCallResult) { return fn(ctx, r); } } as AfterToolCallHook;
    return { name, version: 'custom', async onError(ctx: HookContext, err: Error) { fn(ctx, err); } } as ErrorHook;
  } catch { return null; }
}
