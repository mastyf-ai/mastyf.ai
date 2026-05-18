import { homedir } from 'os';
import { join } from 'path';

const GUARDIAN_DIR = join(homedir(), '.mcp-guardian');

export function resolveAiLearningStatePath(): string {
  if (process.env.GUARDIAN_AI_STATE_PATH) {
    return process.env.GUARDIAN_AI_STATE_PATH;
  }
  return join(GUARDIAN_DIR, '.ai-learning.json');
}

export function resolveAiPendingSuggestionsPath(): string {
  if (process.env.GUARDIAN_AI_SUGGESTIONS_PATH) {
    return process.env.GUARDIAN_AI_SUGGESTIONS_PATH;
  }
  return join(GUARDIAN_DIR, '.ai-pending-suggestions.json');
}

export function resolveAiReportPath(): string {
  if (process.env.GUARDIAN_AI_REPORT_PATH) {
    return process.env.GUARDIAN_AI_REPORT_PATH;
  }
  return join(GUARDIAN_DIR, '.ai-report.json');
}

export function resolveAiBaselinesPath(): string {
  if (process.env.GUARDIAN_AI_BASELINES_PATH) {
    return process.env.GUARDIAN_AI_BASELINES_PATH;
  }
  return join(GUARDIAN_DIR, '.ai-baselines.json');
}

export function resolveAttackLearningStatePath(): string {
  if (process.env.GUARDIAN_AI_ATTACK_STATE_PATH) {
    return process.env.GUARDIAN_AI_ATTACK_STATE_PATH;
  }
  return join(GUARDIAN_DIR, '.attack-learning-state.json');
}
