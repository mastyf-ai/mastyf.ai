import { describe, it, expect } from 'vitest';
import { RequestIdLock } from '../../src/utils/request-id-lock.js';

describe('RequestIdLock', () => {
  it('serializes same request id but allows parallel different ids', async () => {
    const lock = new RequestIdLock();
    const order: string[] = [];

    const delay = (ms: number, label: string, id: string) =>
      lock.enqueue(id, async () => {
        order.push(`start:${label}`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`end:${label}`);
      });

    await Promise.all([delay(30, 'a1', 'req-a'), delay(30, 'b1', 'req-b'), delay(30, 'a2', 'req-a')]);

    expect(order.indexOf('end:a1')).toBeLessThan(order.indexOf('start:a2'));
    expect(order).toContain('start:b1');
    expect(order).toContain('end:b1');
  });
});
