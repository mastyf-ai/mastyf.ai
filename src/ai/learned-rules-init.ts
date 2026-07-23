/**
 * Bootstrap learned-rules overlay at proxy startup.
 */
import {
  reloadLearnedRules,
  startLearnedRulesReloadTimer,
  getLearnedRulesStats,
} from '@mastyf_ai/core';
import { Logger } from '../utils/logger.js';

let stopReload: (() => void) | null = null;

export function bootstrapLearnedRules(): void {
  if (process.env.MASTYF_AI_LEARNED_RULES_ENABLED !== 'true') {
    return;
  }

  try {
    reloadLearnedRules();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    Logger.error(`[bootstrap] Learned rules overlay failed to load: ${msg}`);
    throw err;
  }
  stopReload = startLearnedRulesReloadTimer();
  const stats = getLearnedRulesStats();
  Logger.info(
    `[bootstrap] Learned rules overlay enabled (${stats.total} rules: ${stats.argument} argument, ${stats.localSemantic} local-semantic)`,
  );
}

export function shutdownLearnedRules(): void {
  stopReload?.();
  stopReload = null;
}
