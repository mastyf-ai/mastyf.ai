import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  recordInstantBlockEvent,
  loadAttackLearningState,
  resetInstantAttackLearningState,
  extractReasonNgrams,
} from '../../src/ai/instant-attack-learning.js';
import { resetBlockLearningDebounce } from '../../src/ai/block-learning.js';
import { SelfImprovement } from '../../src/ai/self-improvement.js';
import { LlmAssistant } from '../../src/ai/llm-assistant.js';
import { writeFileSync } from 'fs';
import { dump } from 'js-yaml';

describe('instant attack learning', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'guardian-instant-'));
    process.env.GUARDIAN_AI_ENABLED = 'true';
    process.env.GUARDIAN_AI_INSTANT_LEARNING = 'true';
    process.env.GUARDIAN_AI_ATTACK_MIN_BLOCKS = '3';
    process.env.GUARDIAN_AI_INSTANT_WINDOW_MS = '300000';
    process.env.GUARDIAN_AI_ATTACK_STATE_PATH = join(dir, '.attack-learning-state.json');
    process.env.GUARDIAN_AI_SUGGESTIONS_PATH = join(dir, '.ai-pending-suggestions.json');
    resetInstantAttackLearningState();
    resetBlockLearningDebounce();
  });

  afterEach(() => {
    resetInstantAttackLearningState();
    resetBlockLearningDebounce();
    delete process.env.GUARDIAN_AI_ATTACK_STATE_PATH;
    delete process.env.GUARDIAN_AI_SUGGESTIONS_PATH;
  });

  it('updates attack-learning-state.json after each block', () => {
    recordInstantBlockEvent({
      serverName: 'filesystem',
      toolName: 'read_file',
      block_rule: 'sensitive-path',
      block_reason: 'Blocked path /home/finco/.ssh/config',
      argsFingerprint: 'abc123',
    });

    expect(existsSync(process.env.GUARDIAN_AI_ATTACK_STATE_PATH!)).toBe(true);
    const state = loadAttackLearningState();
    expect(state.totalEvents).toBe(1);
    expect(state.ruleToolCounts['sensitive-path:read_file']?.count).toBe(1);
  });

  it('queues suggestion immediately after 3 blocks of same rule+tool', () => {
    const reason = 'Blocked path /home/finco/.ssh/config';
    for (let i = 0; i < 3; i++) {
      const result = recordInstantBlockEvent({
        serverName: 'filesystem',
        toolName: 'read_file',
        block_rule: 'sensitive-path',
        block_reason: reason,
        argsFingerprint: `fp${i}`,
      });
      if (i < 2) expect(result.queued).toBe(false);
    }

    const pending = JSON.parse(readFileSync(process.env.GUARDIAN_AI_SUGGESTIONS_PATH!, 'utf-8'));
    expect(pending.suggestions.length).toBeGreaterThan(0);
    expect(pending.suggestions[0].source).toBe('attack');
    expect(pending.suggestions[0].ruleName).toMatch(/^attack-learned/);
  });

  it('extractReasonNgrams captures path tokens', () => {
    const ngrams = extractReasonNgrams('Blocked path /home/finco/.ssh/config');
    expect(ngrams.some((n) => n.includes('blocked'))).toBe(true);
  });

  it('does not write policy YAML — only queues pending suggestions', () => {
    process.env.GUARDIAN_AI_AUTO_APPLY = 'false';
    const policyPath = join(dir, 'policy.yaml');
    writeFileSync(
      policyPath,
      dump({
        version: '1.0',
        policy: { mode: 'block', rules: [] },
      }),
    );
    const before = readFileSync(policyPath, 'utf-8');

    for (let i = 0; i < 3; i++) {
      recordInstantBlockEvent({
        serverName: 'filesystem',
        toolName: 'read_file',
        block_rule: 'sensitive-path',
        block_reason: 'Blocked path /home/finco/.ssh/config',
        argsFingerprint: `fp${i}`,
      });
    }

    expect(readFileSync(policyPath, 'utf-8')).toBe(before);
    const pending = JSON.parse(readFileSync(process.env.GUARDIAN_AI_SUGGESTIONS_PATH!, 'utf-8'));
    expect(pending.suggestions.length).toBeGreaterThan(0);
  });

  it('times out slow instant LLM per GUARDIAN_AI_INSTANT_LLM_TIMEOUT_MS', async () => {
    vi.useFakeTimers();
    process.env.GUARDIAN_AI_INSTANT_LLM = 'true';
    process.env.GUARDIAN_AI_INSTANT_LLM_TIMEOUT_MS = '50';
    process.env.GUARDIAN_AI_INSTANT_LLM_RATE_MS = '0';

    const generateSpy = vi.spyOn(LlmAssistant.prototype, 'generate').mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve({ text: '{"attackClass":"secret_exfil","confidence":0.95}' }),
            500,
          );
        }),
    );

    recordInstantBlockEvent({
      serverName: 'filesystem',
      toolName: 'read_file',
      block_rule: 'secret-scan',
      block_reason: 'API key in args',
      argsFingerprint: 'fp-timeout',
    });

    await vi.advanceTimersByTimeAsync(60);
    await vi.runAllTimersAsync();

    expect(generateSpy).toHaveBeenCalled();
    const state = loadAttackLearningState();
    expect(state.knownClassConfidence['secret_exfil'] ?? 0).toBeLessThan(0.7);

    generateSpy.mockRestore();
    vi.useRealTimers();
  });

  it('quorum gates self-improvement threshold changes', () => {
    const statePath = join(dir, '.ai-learning.json');
    process.env.GUARDIAN_AI_STATE_PATH = statePath;
    process.env.GUARDIAN_AI_MIN_DISTINCT_LABELERS = '2';
    process.env.GUARDIAN_AI_MIN_TOTAL_LABELS = '10';

    const engine = new SelfImprovement(statePath);
    const initial = engine.getAdaptiveThreshold();

    const { quorumApplied } = engine.recordOutcome(
      {
        suggestionId: 'instant-attack-1',
        ruleName: 'attack-learned-read',
        source: 'attack',
        action: 'applied',
        confidence: 0.9,
        timestamp: new Date().toISOString(),
      },
      { userId: 'solo-operator' },
    );

    expect(quorumApplied).toBe(false);
    expect(engine.getAdaptiveThreshold()).toBe(initial);
  });
});
