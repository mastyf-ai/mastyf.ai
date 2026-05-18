import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setAttackLearningSharedStore,
  saveAttackLearningState,
  loadAttackLearningFromSharedStore,
  resetInstantAttackLearningState,
  loadAttackLearningState,
} from '../../src/ai/instant-attack-learning.js';

describe('instant attack learning shared store', () => {
  beforeEach(() => {
    resetInstantAttackLearningState();
  });

  it('persists to shared store when configured', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    setAttackLearningSharedStore({
      persistAttackLearningState: persist,
      getAttackLearningState: vi.fn().mockResolvedValue(null),
    });

    const state = loadAttackLearningState();
    state.totalEvents = 42;
    saveAttackLearningState(state);

    await new Promise((r) => setTimeout(r, 10));
    expect(persist).toHaveBeenCalled();
    expect(persist.mock.calls[0][1]).toBe('default');
  });

  it('loads newer remote state from shared store', async () => {
    const remote = {
      version: 1 as const,
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
      totalEvents: 99,
      ruleToolCounts: {},
      reasonNgrams: {},
      recentBlocks: [],
      queuedSuggestionKeys: [],
      knownClassConfidence: {},
    };

    setAttackLearningSharedStore({
      getAttackLearningState: vi.fn().mockResolvedValue(remote),
      persistAttackLearningState: vi.fn(),
    });

    await loadAttackLearningFromSharedStore();
    expect(loadAttackLearningState().totalEvents).toBe(99);
  });
});
