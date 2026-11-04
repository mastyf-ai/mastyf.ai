import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import {
  activeRequestClassifier,
  checkDataFlow,
  checkToolCall,
  loadExtensions,
  observeToolResult,
  setExtensionsForTests,
  type ProxyExtension,
} from '../../src/extensions/index.js';
import type { CallContext } from '../../src/policy/policy-types.js';

const context = { serverName: 's', toolName: 't' } as unknown as CallContext;

afterEach(() => {
  setExtensionsForTests([]);
  vi.restoreAllMocks();
});

describe('with no extension', () => {
  it('blocks nothing and has no classifier', () => {
    expect(checkToolCall(context)).toBeNull();
    expect(checkDataFlow({ sessionKey: 's', toolName: 't' })).toBeNull();
    expect(activeRequestClassifier()).toBeNull();
    expect(() => observeToolResult({ serverName: 's', toolName: 't', result: {} })).not.toThrow();
  });
});

describe('with extensions', () => {
  it('returns the first block', () => {
    const allow: ProxyExtension = { name: 'a', checkToolCall: () => null };
    const block: ProxyExtension = { name: 'b', checkToolCall: () => ({ rule: 'r', reason: 'why' }) };
    setExtensionsForTests([allow, block]);
    expect(checkToolCall(context)).toEqual({ rule: 'r', reason: 'why' });
  });

  it('keeps going when an observer throws', () => {
    const seen = vi.fn();
    setExtensionsForTests([
      { name: 'bad', observeToolResult: () => { throw new Error('boom'); } },
      { name: 'good', observeToolResult: seen },
    ]);
    observeToolResult({ serverName: 's', toolName: 't', result: {} });
    expect(seen).toHaveBeenCalledOnce();
  });

  it('does not turn a failing check into an allow', () => {
    setExtensionsForTests([{ name: 'bad', checkDataFlow: () => { throw new Error('boom'); } }]);
    expect(() => checkDataFlow({ sessionKey: 's', toolName: 't' })).toThrow('boom');
  });

  it('only offers a classifier that is enabled', () => {
    const classify = vi.fn();
    setExtensionsForTests([{ name: 'a', requestClassifier: { enabled: () => false, classify } }]);
    expect(activeRequestClassifier()).toBeNull();
    setExtensionsForTests([{ name: 'a', requestClassifier: { enabled: () => true, classify } }]);
    expect(activeRequestClassifier()?.classify).toBe(classify);
  });
});

describe('loadExtensions', () => {
  it('stops the CLI when a configured extension cannot load', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(loadExtensions(new Command(), './no-such-extension-xyz.js')).rejects.toThrow('exit 1');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('does nothing when none are configured', async () => {
    await expect(loadExtensions(new Command(), '')).resolves.toBeUndefined();
    expect(activeRequestClassifier()).toBeNull();
  });
});
