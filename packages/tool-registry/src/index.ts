export interface RegistryEntry {
  id: string;
  name: string;
  packageName: string;
  description: string;
  version: string;
  repository: string;
  publishedAt: string;
  updatedAt: string;
  trustScore: number;
  trustGrade: TrustGrade;
  cveCount: number;
  criticalCveCount: number;
  downloadCount: number;
  categories: string[];
  authSupported: boolean;
  authProviders: string[];
  badges: RegistryBadge[];
}

export type TrustGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface RegistryBadge {
  type: string;
  label: string;
  color: string;
  achievedAt: string;
}

export interface ScanResult {
  packageName: string;
  trustScore: number;
  trustGrade: TrustGrade;
  cveCount: number;
  criticalCveCount: number;
  typoSquatRisk: number;
  depConfusionRisk: number;
  authScore: number;
  transportScore: number;
  capabilityRisk: number;
  dimensions: {
    cvePosture: number;
    authStrength: number;
    transportSecurity: number;
    abilityRiskSurface: number;
    supplyChainIntegrity: number;
    observedAttackHistory: number;
    responseHygiene: number;
    configurationFreshness: number;
  };
  recommendations: string[];
  scannedAt: string;
}

function computeGrade(score: number): TrustGrade {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  if (score >= 20) return 'D';
  return 'F';
}

export function generateScanResult(params: {
  packageName: string;
  cveCount?: number;
  criticalCveCount?: number;
  authStrength?: 'none' | 'api_key' | 'oauth2' | 'oauth2_mtls';
  transportSecurity?: 'stdio' | 'http' | 'https' | 'mTLS';
  hasTrustedPublisher?: boolean;
  hasTypoSquatRisk?: boolean;
  hasDepConfusionRisk?: boolean;
  knownAttacks?: number;
  hasDlp?: boolean;
  lastUpdatedDays?: number;
}): ScanResult {
  const authStrength = params.authStrength || 'none';
  const transportSecurity = params.transportSecurity || 'https';
  const lastUpdatedDays = params.lastUpdatedDays || 0;

  const cvePosture = Math.max(0, 100 - ((params.cveCount || 0) * 10) - ((params.criticalCveCount || 0) * 25));
  const mappedAuthScore = { none: 0, api_key: 30, oauth2: 70, oauth2_mtls: 100 }[authStrength];
  const mappedTransportScore = { stdio: 10, http: 30, https: 60, mTLS: 100 }[transportSecurity];
  const supplyChainScore = (params.hasTrustedPublisher ? 70 : 30) - (params.hasTypoSquatRisk ? 30 : 0) - (params.hasDepConfusionRisk ? 20 : 0);
  const capabilityRisk = 60;
  const attackHistoryScore = Math.max(0, 100 - ((params.knownAttacks || 0) * 15));
  const responseHygieneScore = params.hasDlp ? 80 : 40;
  const freshnessScore = Math.max(0, 100 - lastUpdatedDays * 2);

  const dimensions = {
    cvePosture: Math.round(cvePosture),
    authStrength: mappedAuthScore,
    transportSecurity: mappedTransportScore,
    abilityRiskSurface: capabilityRisk,
    supplyChainIntegrity: Math.max(0, supplyChainScore),
    observedAttackHistory: attackHistoryScore,
    responseHygiene: responseHygieneScore,
    configurationFreshness: Math.round(freshnessScore),
  };

  const dimValues = Object.values(dimensions);
  const score = Math.round(dimValues.reduce((a, b) => a + b, 0) / dimValues.length);

  const recommendations: string[] = [];
  if (dimensions.authStrength < 50) recommendations.push('Add OAuth 2.1 authentication support');
  if (dimensions.transportSecurity < 60) recommendations.push('Enable HTTPS transport with mTLS');
  if (params.criticalCveCount && params.criticalCveCount > 0) recommendations.push(`Patch ${params.criticalCveCount} critical CVEs`);
  if (params.hasTypoSquatRisk) recommendations.push('Register typo-squat variations of the package name');
  if (!params.hasDlp) recommendations.push('Enable response DLP scanning');
  if (lastUpdatedDays > 90) recommendations.push('Update package to latest version');

  return {
    packageName: params.packageName,
    trustScore: score,
    trustGrade: computeGrade(score),
    cveCount: params.cveCount || 0,
    criticalCveCount: params.criticalCveCount || 0,
    typoSquatRisk: params.hasTypoSquatRisk ? 50 : 0,
    depConfusionRisk: params.hasDepConfusionRisk ? 50 : 0,
    authScore: dimensions.authStrength,
    transportScore: dimensions.transportSecurity,
    capabilityRisk: dimensions.abilityRiskSurface,
    dimensions,
    recommendations,
    scannedAt: new Date().toISOString(),
  };
}

export function generateBadgeSvg(score: number, grade: TrustGrade): string {
  const colors: Record<TrustGrade, string> = {
    'A+': '#22c55e',
    'A': '#22c55e',
    'B': '#3b82f6',
    'C': '#f59e0b',
    'D': '#f97316',
    'F': '#ef4444',
  };

  const color = colors[grade] || '#6b7280';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="20">
  <rect width="80" height="20" fill="#1f2937" rx="3"/>
  <text x="40" y="14" fill="#f9fafb" font-size="11" font-family="monospace" text-anchor="middle" font-weight="bold">Mastyf ${grade}</text>
  <rect x="80" width="60" height="20" fill="${color}" rx="3"/>
  <text x="110" y="14" fill="#fff" font-size="11" font-family="monospace" text-anchor="middle">${score}/100</text>
</svg>`;
}
