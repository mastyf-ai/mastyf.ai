import { describe, it, expect } from 'vitest';
import { ToolCallHookRegistry, createRateLimitHook, createPiiRedactionHook, createCustomHook } from '../../src/policy/tool-call-hooks.js';

describe('ToolCallHookRegistry', () => {
  it('registers and lists hooks', () => {
    const registry = new ToolCallHookRegistry();
    registry.registerBefore(createRateLimitHook({ maxCallsPerMinute: 60, perUser: true }));
    const hooks = registry.listHooks();
    expect(hooks.length).toBe(1);
    expect(hooks[0].name).toBe('builtin-rate-limit');
    expect(hooks[0].type).toBe('before');
    expect(hooks[0].enabled).toBe(true);
  });

  it('enables and disables hooks', () => {
    const registry = new ToolCallHookRegistry();
    registry.registerBefore(createRateLimitHook({ maxCallsPerMinute: 60, perUser: true }));
    registry.disableHook('builtin-rate-limit');
    expect(registry.listHooks()[0].enabled).toBe(false);
    registry.enableHook('builtin-rate-limit');
    expect(registry.listHooks()[0].enabled).toBe(true);
  });

  it('runs before hooks in priority order', async () => {
    const registry = new ToolCallHookRegistry();
    const order: string[] = [];
    registry.registerBefore({ name: 'low', priority: 20, async beforeToolCall() { order.push('low'); return { allowed: true }; } });
    registry.registerBefore({ name: 'high', priority: 5, async beforeToolCall() { order.push('high'); return { allowed: true }; } });
    await registry.runBeforeHooks({
      tool: { serverName: 'test', toolName: 'test', arguments: {}, requestId: '1' },
      timestamp: new Date().toISOString(),
      hookState: new Map(),
    });
    expect(order).toEqual(['high', 'low']);
  });

  it('blocks when hook returns false', async () => {
    const registry = new ToolCallHookRegistry();
    registry.registerBefore({
      name: 'blocker', priority: 1,
      async beforeToolCall() { return { allowed: false, reason: 'test block' }; },
    });
    const result = await registry.runBeforeHooks({
      tool: { serverName: 'test', toolName: 'test', arguments: {}, requestId: '1' },
      timestamp: new Date().toISOString(),
      hookState: new Map(),
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('test block');
  });

  it('creates custom hook from code', () => {
    const hook = createCustomHook('test-hook', 'return { allowed: true }', 'before', 50);
    expect(hook).not.toBeNull();
    if (hook) {
      expect(hook.name).toBe('test-hook');
      expect((hook as any).priority).toBe(50);
    }
  });

  it('PII redaction hook exists and has patterns', () => {
    const hook = createPiiRedactionHook(['api_key', 'password']);
    expect(hook.name).toBe('builtin-pii-redaction');
    expect(hook.priority).toBe(20);
  });
});
