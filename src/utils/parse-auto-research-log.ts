export type AutoResearchBatchOutcome = {
  written: number;
  attempted: number;
  skips: {
    duplicate: number;
    belowMinConfidence: number;
    replayFailed: number;
    llmUnavailable: number;
    llmDiscoveryNull: number;
    other: number;
  };
  summaryLine: string | null;
};

const WRITE_SUMMARY_RE = /wrote\s+(\d+)\s*\/\s*(\d+)\s+fixture\(s\)/i;

function classifySkipReason(line: string): keyof AutoResearchBatchOutcome['skips'] {
  const lower = line.toLowerCase();
  if (lower.includes('duplicate fingerprint')) return 'duplicate';
  if (lower.includes('fixture write skipped')) return 'duplicate';
  if (lower.includes('below min confidence')) return 'belowMinConfidence';
  if (lower.includes('replay smoke test failed') || lower.includes('not blocked by current policy')) {
    return 'replayFailed';
  }
  if (lower.includes('llm unavailable') || lower.includes('llm disabled')) return 'llmUnavailable';
  if (lower.includes('llm discovery returned null') || lower.includes('discovery returned null')) {
    return 'llmDiscoveryNull';
  }
  return 'other';
}

export function parseAutoResearchLogTail(logTail: string | null | undefined): AutoResearchBatchOutcome {
  const lines = String(logTail || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const summaryLine = [...lines].reverse().find((line) => WRITE_SUMMARY_RE.test(line)) || null;
  const match = summaryLine ? summaryLine.match(WRITE_SUMMARY_RE) : null;

  const skips: AutoResearchBatchOutcome['skips'] = {
    duplicate: 0,
    belowMinConfidence: 0,
    replayFailed: 0,
    llmUnavailable: 0,
    llmDiscoveryNull: 0,
    other: 0,
  };

  for (const line of lines) {
    if (!line.startsWith('✗')) continue;
    skips[classifySkipReason(line)] += 1;
  }

  return {
    written: match ? Number(match[1]) : 0,
    attempted: match ? Number(match[2]) : 0,
    skips,
    summaryLine,
  };
}
