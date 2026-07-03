import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadPendingSuggestions,
  removePendingSuggestion,
  recordSuggestionOutcome,
} from '../../src/ai/suggestion-engine.js';

describe('pending suggestions queue', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mastyf-pending-'));
    process.env.MASTYF_AI_AI_SUGGESTIONS_PATH = join(dir, '.ai-pending-suggestions.json');
    writeFileSync(process.env.MASTYF_AI_AI_SUGGESTIONS_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      suggestions: [
        {
          id: 'attack-1',
          ruleName: 'attack-learned-read_file',
          rule: { name: 'attack-learned-read_file', action: 'block', patterns: ['.*'] },
          confidence: 0.9,
          reason: 'test',
          source: 'attack',
        },
        {
          id: 'baseline-2',
          ruleName: 'baseline-anomaly',
          rule: { name: 'baseline-anomaly', action: 'flag' },
          confidence: 0.7,
          reason: 'test',
          source: 'baseline',
        },
      ],
    }, null, 2));
  });

  afterEach(() => {
    delete process.env.MASTYF_AI_AI_SUGGESTIONS_PATH;
  });

  it('removePendingSuggestion drops by id', () => {
    expect(removePendingSuggestion('attack-1')).toBe(true);
    const pending = loadPendingSuggestions();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe('baseline-2');
  });

  it('recordSuggestionOutcome removes rejected items from the queue', async () => {
    await recordSuggestionOutcome('baseline-2', 'rejected', {
      ruleName: 'baseline-anomaly',
      source: 'baseline',
      confidence: 0.7,
    });
    const pending = loadPendingSuggestions();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe('attack-1');
    const raw = JSON.parse(readFileSync(process.env.MASTYF_AI_AI_SUGGESTIONS_PATH!, 'utf-8'));
    expect(raw.suggestions).toHaveLength(1);
  });
});
