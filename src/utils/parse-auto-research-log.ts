export type AutoResearchBatchOutcome = {
  written: number;
  attempted: number;
  skips: {
    duplicate: number;
    belowMinConfidence: number;
    other: number;
  };
  summaryLine: string | null;
};

const WRITE_SUMMARY_RE = /wrote\s+(\d+)\s*\/\s*(\d+)\s+fixture\(s\)/i;

export function parseAutoResearchLogTail(logTail: string | null | undefined): AutoResearchBatchOutcome {
  const lines = String(logTail || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const summaryLine = [...lines].reverse().find((line) => WRITE_SUMMARY_RE.test(line)) || null;
  const match = summaryLine ? summaryLine.match(WRITE_SUMMARY_RE) : null;

  let duplicate = 0;
  let belowMinConfidence = 0;
  let other = 0;
  for (const line of lines) {
    if (!line.startsWith('✗')) continue;
    if (line.includes('duplicate fingerprint')) {
      duplicate += 1;
    } else if (line.includes('below min confidence')) {
      belowMinConfidence += 1;
    } else {
      other += 1;
    }
  }

  return {
    written: match ? Number(match[1]) : 0,
    attempted: match ? Number(match[2]) : 0,
    skips: { duplicate, belowMinConfidence, other },
    summaryLine,
  };
}
