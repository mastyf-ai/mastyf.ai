import { Logger } from './logger.js';
import { semanticLlmOnline } from './metrics.js';

const DEFAULT_INTERVAL_MS = 30000;
const MAX_CONSECUTIVE_FAILURES = 3;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let consecutiveFailures = 0;
let previousState = true;

export function startLlmHealthCheck(intervalMs = DEFAULT_INTERVAL_MS): void {
  const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

  const check = async () => {
    try {
      const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        consecutiveFailures = 0;
        if (!previousState) {
          Logger.info('[llm-health] Ollama recovered');
        }
        previousState = true;
        semanticLlmOnline.set(1);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err: any) {
      consecutiveFailures++;
      Logger.warn(`[llm-health] Ollama unreachable (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${err.message}`);
      semanticLlmOnline.set(0);
      previousState = false;

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        // Re-enable local heuristic fallback after consecutive failures
        try {
          process.env.MASTYF_AI_LOCAL_SEMANTIC_ENABLED = 'true';
          Logger.warn('[llm-health] Re-enabling local semantic fallback after LLM failures');
        } catch {}
      }
    }
  };

  check();
  pollTimer = setInterval(check, intervalMs);
  Logger.info(`[llm-health] Health check started (polling ${ollamaUrl} every ${intervalMs}ms)`);
}

export function stopLlmHealthCheck(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  Logger.info('[llm-health] Health check stopped');
}

export function isLlmHealthy(): boolean {
  return consecutiveFailures < MAX_CONSECUTIVE_FAILURES;
}
