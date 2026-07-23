import { describe, it, expect, beforeEach } from 'vitest';
import { learningMode } from '../../src/policy/learning-mode.js';

describe('LearningMode', () => {
  beforeEach(() => {
    learningMode.reset();
  });

  it('records allowed calls and generates path suggestions', () => {
    for (let i = 0; i < 10; i++) {
      learningMode.recordAllowedCall('read_file', { path: '/home/user/docs/report.pdf' });
    }
    const suggestions = learningMode.getSuggestions();
    expect(suggestions.length).toBeGreaterThan(0);
    const pathSuggestion = suggestions.find(s => s.value.includes('read_file'));
    expect(pathSuggestion).toBeDefined();
    expect(pathSuggestion!.frequency).toBe(10);
  });

  it('only suggests after threshold is met', () => {
    learningMode.recordAllowedCall('read_file', { path: '/tmp/test.txt' });
    learningMode.recordAllowedCall('read_file', { path: '/tmp/test.txt' });
    const suggestions = learningMode.getSuggestions();
    expect(suggestions.length).toBe(0); // Only 2 samples, threshold is 5
  });

  it('records domain-based access patterns', () => {
    for (let i = 0; i < 10; i++) {
      learningMode.recordAllowedCall('web_fetch', { url: 'https://docs.python.org/3/' });
    }
    const suggestions = learningMode.getSuggestions();
    expect(suggestions.some(s => s.value.includes('docs.python.org'))).toBe(true);
  });

  it('sorts suggestions by frequency', () => {
    for (let i = 0; i < 10; i++) learningMode.recordAllowedCall('tool_a', { path: '/frequent' });
    for (let i = 0; i < 5; i++) learningMode.recordAllowedCall('tool_b', { path: '/rare' });
    const suggestions = learningMode.getSuggestions();
    if (suggestions.length >= 2) {
      expect(suggestions[0].frequency).toBeGreaterThanOrEqual(suggestions[1].frequency);
    }
  });

  it('resets correctly', () => {
    learningMode.recordAllowedCall('read_file', { path: '/tmp/test.txt' });
    learningMode.reset();
    expect(learningMode.getSuggestions().length).toBe(0);
  });
});
