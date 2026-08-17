/**
 * Score history and trend tracking — records score changes over time,
 * detects significant changes, and generates alerts.
 */

import type { ScoreResult } from './package-scorer';

export type ScoreHistoryEntry = {
  id?: number;
  packageName: string;
  score: number;
  grade: string;
  level: string;
  dimensions: Record<string, number>;
  computedAt: string;
  trigger: 'scheduled' | 'manual' | 'alert';
};

export type ScoreChange = {
  packageName: string;
  previousScore: number;
  newScore: number;
  delta: number;
  direction: 'improved' | 'degraded';
  gradeChanged: boolean;
  previousGrade: string;
  newGrade: string;
  possibleCauses: string[];
  detectedAt: string;
};

export type AlertSeverity = 'info' | 'warning' | 'critical';

export type ScoreAlert = {
  packageName: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  previousScore: number;
  newScore: number;
  delta: number;
  detectedAt: string;
};

// ── Noise threshold: ignore changes smaller than this ──
const NOISE_THRESHOLD = 5;

// ── Record a score history entry ──
export function recordScoreEntry(
  result: ScoreResult,
  trigger: ScoreHistoryEntry['trigger'] = 'scheduled',
): ScoreHistoryEntry {
  return {
    packageName: result.packageName,
    score: result.score,
    grade: result.grade,
    level: result.level,
    dimensions: { ...result.dimensions },
    computedAt: result.computedAt,
    trigger,
  };
}

// ── Detect score change between two entries ──
export function detectScoreChange(
  previous: ScoreHistoryEntry,
  current: ScoreHistoryEntry,
): ScoreChange | null {
  const delta = current.score - previous.score;
  if (Math.abs(delta) < NOISE_THRESHOLD) return null;

  const previousGrade = previous.grade;
  const newGrade = current.grade;
  const gradeChanged = previousGrade !== newGrade;

  // Detect possible causes by comparing dimensions
  const possibleCauses = detectCauses(previous, current);

  return {
    packageName: current.packageName,
    previousScore: previous.score,
    newScore: current.score,
    delta,
    direction: delta > 0 ? 'improved' : 'degraded',
    gradeChanged,
    previousGrade,
    newGrade,
    possibleCauses,
    detectedAt: new Date().toISOString(),
  };
}

// ── Detect possible causes of score change ──
function detectCauses(
  previous: ScoreHistoryEntry,
  current: ScoreHistoryEntry,
): string[] {
  const causes: string[] = [];
  const dims = Object.keys(current.dimensions);

  for (const dim of dims) {
    const prev = previous.dimensions[dim] ?? 0;
    const curr = current.dimensions[dim] ?? 0;
    const delta = curr - prev;

    if (Math.abs(delta) < 3) continue; // small changes

    const dimName = formatDimensionName(dim);
    if (delta > 0) {
      causes.push(`${dimName} improved by ${delta} points`);
    } else {
      causes.push(`${dimName} degraded by ${Math.abs(delta)} points`);
    }
  }

  // Grade change
  if (previous.grade !== current.grade) {
    causes.push(`Grade changed from ${previous.grade} to ${current.grade}`);
  }

  return causes.slice(0, 5); // limit to top 5
}

// ── Generate alerts from score changes ──
export function generateAlerts(change: ScoreChange): ScoreAlert[] {
  const alerts: ScoreAlert[] = [];

  // Score drop alert
  if (change.delta < -10) {
    alerts.push({
      packageName: change.packageName,
      severity: 'critical',
      title: 'Score degraded significantly',
      description: `Score dropped from ${change.previousScore} to ${change.newScore} (${change.delta} points). Possible new vulnerability or maintainer change.`,
      previousScore: change.previousScore,
      newScore: change.newScore,
      delta: change.delta,
      detectedAt: change.detectedAt,
    });
  } else if (change.delta < -5) {
    alerts.push({
      packageName: change.packageName,
      severity: 'warning',
      title: 'Score degraded',
      description: `Score dropped from ${change.previousScore} to ${change.newScore} (${change.delta} points).`,
      previousScore: change.previousScore,
      newScore: change.newScore,
      delta: change.delta,
      detectedAt: change.detectedAt,
    });
  }

  // Grade change alert
  if (change.gradeChanged) {
    alerts.push({
      packageName: change.packageName,
      severity: change.delta < 0 ? 'warning' : 'info',
      title: `Grade changed from ${change.previousGrade} to ${change.newGrade}`,
      description: `The package grade has ${change.direction === 'improved' ? 'improved' : 'degraded'}.`,
      previousScore: change.previousScore,
      newScore: change.newScore,
      delta: change.delta,
      detectedAt: change.detectedAt,
    });
  }

  // Score improvement alert
  if (change.delta > 15) {
    alerts.push({
      packageName: change.packageName,
      severity: 'info',
      title: 'Score improved significantly',
      description: `Score increased from ${change.previousScore} to ${change.newScore} (+${change.delta} points).`,
      previousScore: change.previousScore,
      newScore: change.newScore,
      delta: change.delta,
      detectedAt: change.detectedAt,
    });
  }

  return alerts;
}

// ── Format dimension name for display ──
function formatDimensionName(dim: string): string {
  const map: Record<string, string> = {
    cvePosture: 'CVE Posture',
    supplyChainIntegrity: 'Supply Chain',
    authStrength: 'Authentication',
    transportSecurity: 'Transport Security',
    observedAttackHistory: 'Attack History',
    responseHygiene: 'Response Hygiene',
    configurationFreshness: 'Freshness',
    abilityRiskSurface: 'Tool Risk',
    licenseRisk: 'License',
    downloadHealth: 'Download Health',
  };
  return map[dim] ?? dim;
}

// ── Format score history for display ──
export function formatScoreHistory(history: ScoreHistoryEntry[]): string {
  if (history.length === 0) return 'No score history available.';

  const lines = history
    .sort((a, b) => new Date(b.computedAt).getTime() - new Date(a.computedAt).getTime())
    .map((entry) => {
      const date = new Date(entry.computedAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
      });
      return `${date}: ${entry.score} (${entry.grade})`;
    });

  return lines.join('\n');
}

// ── Format alert for display ──
export function formatAlert(alert: ScoreAlert): string {
  const icon = alert.severity === 'critical' ? '🔴' : alert.severity === 'warning' ? '🟡' : '🟢';
  return `${icon} ${alert.title}\n   ${alert.description}`;
}
