export type ProbeSeverity = 'critical' | 'high' | 'medium' | 'low';

export type ProbeFindingCategory =
  | 'secret-leak'
  | 'dangerous-exec'
  | 'suspicious-egress'
  | 'install-script'
  | 'obfuscation';

export type ProbeFinding = {
  id: string;
  category: ProbeFindingCategory;
  severity: ProbeSeverity;
  title: string;
  file: string;
  line: number;
  evidence: string;
  plainEnglish: string;
};

export type ProbeResult = {
  status: 'ok' | 'unable';
  reason?: string;
  packageName: string;
  version: string;
  filesScanned: number;
  bytesScanned: number;
  durationMs: number;
  findings: ProbeFinding[];
  counts: { critical: number; high: number; medium: number; low: number };
};

export function probePackage(packageName: string, version?: string): Promise<ProbeResult>;
export function behavioralScoreFromProbe(probe: ProbeResult | null | undefined): number;
