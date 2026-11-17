import { describe, expect, it } from 'vitest';
import { Poller } from '../src/poller';

function fakeTimers() {
  let next = 1;
  const live = new Map<number, number>();
  return {
    live,
    setInterval: (_fn: () => void, ms: number) => {
      const id = next++;
      live.set(id, ms);
      return id;
    },
    clearInterval: (id: number) => {
      live.delete(id);
    },
  };
}

describe('Poller', () => {
  it('polls only while the window has focus', () => {
    const t = fakeTimers();
    let polls = 0;
    const p = new Poller(() => polls++, () => 15, t);
    p.setFocused(false);
    p.settingsChanged();
    expect(t.live.size).toBe(0);
    expect(polls).toBe(0);
    p.setFocused(true);
    expect(t.live.size).toBe(1);
    expect(polls).toBe(1);
    p.setFocused(false);
    expect(t.live.size).toBe(0);
  });

  it('a settings change restarts polling with the new interval only when focused', () => {
    const t = fakeTimers();
    let seconds = 15;
    const p = new Poller(() => undefined, () => seconds, t);
    p.setFocused(true);
    seconds = 30;
    p.settingsChanged();
    expect([...t.live.values()]).toEqual([30_000]);
  });

  it('dispose stops it for good', () => {
    const t = fakeTimers();
    const p = new Poller(() => undefined, () => 15, t);
    p.setFocused(true);
    p.dispose();
    p.setFocused(true);
    p.settingsChanged();
    expect(t.live.size).toBe(0);
  });
});
