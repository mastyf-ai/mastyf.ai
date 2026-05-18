import { describe, it, expect } from 'vitest';
import { ProxyRequestContextStore } from '../../src/proxy/proxy-request-context.js';

describe('ProxyRequestContextStore', () => {
  it('isolates concurrent request state by id', () => {
    const store = new ProxyRequestContextStore();
    store.set(1, {
      requestStartTime: 100,
      requestToolName: 'a',
      requestTokens: 10,
      requestRaw: '{}',
    });
    store.set(2, {
      requestStartTime: 200,
      requestToolName: 'b',
      requestTokens: 20,
      requestRaw: '{"x":1}',
    });
    expect(store.get(1)?.requestToolName).toBe('a');
    expect(store.get(2)?.requestToolName).toBe('b');
    store.delete(1);
    expect(store.get(1)).toBeUndefined();
    expect(store.get(2)?.requestToolName).toBe('b');
  });
});
