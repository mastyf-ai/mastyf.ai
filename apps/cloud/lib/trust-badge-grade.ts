/** Letter grade + color helpers for cloud-hosted MCP security badges. */

export type TrustGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

export const TRUST_GRADE_COLORS: Record<TrustGrade, string> = {
  'A+': '#00C853',
  A: '#64DD17',
  B: '#FFD600',
  C: '#FF9100',
  D: '#FF3D00',
  F: '#D50000',
};

export function computeTrustGrade(score: number): TrustGrade {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

export function trustGradeColor(grade: TrustGrade | string): string {
  return TRUST_GRADE_COLORS[grade as TrustGrade] || '#64748b';
}

export function trustGradeTextColor(grade: TrustGrade | string): string {
  return grade === 'B' ? '#1a1a1a' : '#ffffff';
}

export function scoreToLevel(score: number): string {
  if (score >= 90) return 'platinum';
  if (score >= 75) return 'gold';
  if (score >= 60) return 'silver';
  return 'bronze';
}
