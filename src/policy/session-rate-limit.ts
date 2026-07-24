import { LRUCache } from 'lru-cache';

interface RateLimitState {
  count: number;
  windowStart: number;
}

interface SessionRateLimitOptions {
  maxCallsPerMinute: number;
  sessionId: string;
  toolName?: string;
}

const sessionRateLimits = new LRUCache<string, RateLimitState>({
  max: 10000,
  ttl: 60 * 1000,
  updateAgeOnGet: false,
});

function rateLimitKey(opts: SessionRateLimitOptions): string {
  const base = `session:${opts.sessionId}`;
  return opts.toolName ? `${base}:tool:${opts.toolName}` : base;
}

export function checkSessionRateLimit(opts: SessionRateLimitOptions): { allowed: boolean; current: number; remaining: number } {
  const key = rateLimitKey(opts);
  const now = Date.now();
  const state = sessionRateLimits.get(key);

  if (!state || now - state.windowStart > 60_000) {
    sessionRateLimits.set(key, { count: 1, windowStart: now });
    return { allowed: true, current: 1, remaining: opts.maxCallsPerMinute - 1 };
  }

  state.count++;
  if (state.count > opts.maxCallsPerMinute) {
    return { allowed: false, current: state.count, remaining: 0 };
  }

  return { allowed: true, current: state.count, remaining: opts.maxCallsPerMinute - state.count };
}

export function createSessionRateLimitHook(maxCallsPerMinute: number = 120) {
  return {
    name: 'session-rate-limit',
    priority: 30,
    async beforeToolCall(context: any): Promise<{ allowed: boolean; reason?: string }> {
      const sessionId = context.tool?.serverName || context.identity?.sub || 'unknown';
      const toolName = context.tool?.toolName;

      const check = checkSessionRateLimit({ maxCallsPerMinute, sessionId, toolName });
      if (!check.allowed) {
        return {
          allowed: false,
          reason: `Session rate limit exceeded: ${check.current}/${maxCallsPerMinute} calls per minute for ${toolName || 'all tools'}`,
        };
      }
      return { allowed: true };
    },
  };
}
