import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { load, dump } from 'js-yaml';
import { HistoryDatabase } from '../../src/database/history-db.js';
import { learnAttackPatterns } from '../../src/ai/attack-pattern-learner.js';
import {
  fingerprintArgs,
  onPolicyBlock,
  recordBlockLearningEvent,
  resetBlockLearningDebounce,
  ingestPolicyDecision,
} from '../../src/ai/block-learning.js';
import { resetInstantAttackLearningState } from '../../src/ai/instant-attack-learning.js';
import {
  registerDataCollector,
  DataCollector,
  recordPolicyDecisionGlobal,
} from '../../src/ai/data-collector.js';
import { applySuggestionToPolicy } from '../../src/ai/policy-applier.js';
import { runLearningCycleForDb } from '../../src/ai/suggestion-engine.js';
import { resolveAiPendingSuggestionsPath } from '../../src/ai/ai-paths.js';
import type { ProxyCallRecord } from '../../src/types.js';

async function seedBlocked(
  db: HistoryDatabase,
  serverName: string,
  toolName: string,
  blockRule: string,
  blockReason: string,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    const record: ProxyCallRecord = {
      serverName,
      toolName,
      requestTokens: 10,
      responseTokens: 0,
      totalTokens: 10,
      durationMs: 5,
      timestamp: new Date().toISOString(),
      blocked: true,
      blockRule,
      blockReason,
    };
    await db.addCallRecord(record);
  }
}

describe('attack-driven learning', () => {
  beforeEach(() => {
    resetBlockLearningDebounce();
    resetInstantAttackLearningState();
    process.env.GUARDIAN_AI_ENABLED = 'true';
    process.env.GUARDIAN_AI_USE_DB_SNAPSHOTS = 'true';
    process.env.GUARDIAN_AI_SKIP_INITIAL_CYCLE = 'true';
    process.env.GUARDIAN_AI_DISABLE_PERIODIC = 'true';
    process.env.GUARDIAN_AI_ATTACK_MIN_BLOCKS = '3';
  });

  afterEach(() => {
    resetBlockLearningDebounce();
    vi.useRealTimers();
  });

  it('fingerprintArgs returns stable 16-char hex', () => {
    const a = fingerprintArgs({ path: '/etc/passwd', z: 1 });
    const b = fingerprintArgs({ z: 1, path: '/etc/passwd' });
    expect(a).toHaveLength(16);
    expect(a).toBe(b);
  });

  it('learnAttackPatterns suggests argPattern after repeated blocks', () => {
    const records: ProxyCallRecord[] = [];
    for (let i = 0; i < 4; i++) {
      records.push({
        serverName: 'filesystem',
        toolName: 'read_file',
        requestTokens: 1,
        responseTokens: 0,
        totalTokens: 1,
        durationMs: 1,
        timestamp: new Date().toISOString(),
        blocked: true,
        blockRule: 'sensitive-path',
        blockReason: `Blocked path /home/finco/.ssh/config attempt ${i}`,
      });
    }
    const suggestions = learnAttackPatterns(records);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].rule.name).toMatch(/^attack-learned/);
    expect(suggestions[0].source).toBe('attack');
  });

  it('recordPolicyDecisionGlobal feeds collector metadata', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'guardian-adl-'));
    const db = new HistoryDatabase(join(dir, 'h.db'));
    const collector = new DataCollector(db);
    registerDataCollector(collector);
    ingestPolicyDecision({
      requestId: '1',
      serverName: 's',
      toolName: 'read_file',
      action: 'block',
      rule: 'sensitive-path',
      reason: 'test',
      timestamp: new Date().toISOString(),
      requestTokens: 1,
    });
    expect(collector.getPolicyDecisions()).toHaveLength(1);
    recordPolicyDecisionGlobal({
      requestId: '2',
      serverName: 's',
      toolName: 'read_file',
      action: 'pass',
      rule: 'default',
      reason: 'ok',
      timestamp: new Date().toISOString(),
      requestTokens: 1,
    });
    expect(collector.getPolicyDecisions()).toHaveLength(2);
  });

  it('runLearningCycle surfaces attack suggestions from blocked call_records', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'guardian-adl-cycle-'));
    const pendingPath = join(dir, '.ai-pending-suggestions.json');
    process.env.GUARDIAN_AI_SUGGESTIONS_PATH = pendingPath;
    process.env.GUARDIAN_AI_STATE_PATH = join(dir, '.ai-learning.json');
    process.env.GUARDIAN_AI_BASELINES_PATH = join(dir, '.ai-baselines.json');

    const db = new HistoryDatabase(join(dir, 'history.db'));
    await seedBlocked(db, 'filesystem', 'read_file', 'sensitive-path', 'path /home/finco/.ssh/config', 4);
    await seedBlocked(db, 'filesystem', 'db_query', 'sql-exfil', 'SELECT customer_name FROM accounts', 4);

    const result = await runLearningCycleForDb(db, [{ name: 'filesystem', transport: 'stdio' }]);
    expect(result).not.toBeNull();
    const attack = result!.suggestions.filter((s) => s.source === 'attack');
    expect(attack.length).toBeGreaterThan(0);
    expect(existsSync(pendingPath)).toBe(true);
    const pending = JSON.parse(readFileSync(pendingPath, 'utf-8'));
    expect(pending.suggestions.some((s: { source: string }) => s.source === 'attack')).toBe(true);
  });

  it('recordBlockLearningEvent updates instant state synchronously', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guardian-adl-instant-'));
    process.env.GUARDIAN_AI_ATTACK_STATE_PATH = join(dir, '.attack-learning-state.json');
    process.env.GUARDIAN_AI_INSTANT_LEARNING = 'true';

    recordBlockLearningEvent({
      block_rule: 'secret-scan',
      block_reason: 'API key in args',
      toolName: 'write_file',
      serverName: 'filesystem',
      argsFingerprint: 'abc',
    });

    const state = JSON.parse(readFileSync(join(dir, '.attack-learning-state.json'), 'utf-8'));
    expect(state.totalEvents).toBe(1);
  });

  it('onPolicyBlock schedules debounced flush without throwing', async () => {
    vi.useFakeTimers();
    process.env.GUARDIAN_AI_BLOCK_DEBOUNCE_MS = '50';
    onPolicyBlock({
      block_rule: 'secret-scan',
      toolName: 'write_file',
      serverName: 'filesystem',
      argsFingerprint: 'abc',
    });
    onPolicyBlock({
      block_rule: 'secret-scan',
      toolName: 'write_file',
      serverName: 'filesystem',
      argsFingerprint: 'def',
    });
    await vi.advanceTimersByTimeAsync(60);
    resetBlockLearningDebounce();
  });

  it('applySuggestionToPolicy merges rule without duplicates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guardian-policy-'));
    const policyPath = join(dir, 'policy.yaml');
    writeFileSync(
      policyPath,
      dump({
        version: '1.0',
        policy: { mode: 'block', rules: [{ name: 'existing', action: 'pass' }] },
      }),
    );
    const rule = {
      name: 'attack-learned-test',
      action: 'block' as const,
      tools: { deny: ['read_file'] },
    };
    const first = applySuggestionToPolicy(rule, policyPath);
    expect(first.applied).toBe(true);
    const second = applySuggestionToPolicy(rule, policyPath);
    expect(second.applied).toBe(false);
    const parsed = load(readFileSync(policyPath, 'utf-8')) as { policy: { rules: { name: string }[] } };
    expect(parsed.policy.rules.filter((r) => r.name === 'attack-learned-test')).toHaveLength(1);
  });
});
