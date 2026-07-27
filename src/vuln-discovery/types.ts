/**
 * Vuln Discovery Engine — core types for unpublished / pre-advisory findings.
 */

export type VulnClass =
  | 'dependency'
  | 'implementation'
  | 'config'
  | 'protocol'
  | 'auth'
  | 'injection'
  | 'behavioral';

export type VulnSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type VulnStatus = 'candidate' | 'validated' | 'rejected' | 'disclosed';

export type VulnTargetKind = 'mcp_server' | 'npm_package' | 'upstream_api' | 'tool_handler';

export interface VulnTarget {
  kind: VulnTargetKind;
  name: string;
  version?: string;
  url?: string;
}

export interface VulnEvidence {
  reproSteps: string[];
  payloads?: unknown[];
  stackTrace?: string;
  scanner: string;
  request?: unknown;
  response?: unknown;
  proxyDecision?: string;
  rule?: string;
}

export interface VulnExploitability {
  preAuth: boolean;
  networkReachable: boolean;
  userInteraction: boolean;
}

export interface VulnFinding {
  id: string;
  class: VulnClass;
  severity: VulnSeverity;
  status: VulnStatus;
  title: string;
  description: string;
  target: VulnTarget;
  evidence: VulnEvidence;
  exploitability: VulnExploitability;
  relatedCve?: string;
  discoveredAt: string;
  validatedAt?: string;
  analysisReportId?: string;
  fingerprint?: string;
  tenantId?: string;
}

export interface VulnAnalysisSections {
  executiveSummary: string;
  technicalDeepDive: string;
  exploitScenario: string;
  impactAssessment: string;
  affectedComponents: string;
  evidenceAndRepro: string;
  similarPublishedCves: string;
  estimatedSeverity: string;
  mitigations: string;
  mastyfRecommendations: string;
  disclosureGuidance: string;
}

export interface VulnAnalysisCitation {
  id: string;
  kind: string;
  excerpt: string;
}

export interface VulnAnalysisReport {
  id: string;
  findingId: string;
  generatedAt: string;
  status: 'draft' | 'final' | 'stale';
  provider: string;
  model: string;
  format: 'markdown' | 'plain';
  sections: VulnAnalysisSections;
  fullText: string;
  citations: VulnAnalysisCitation[];
  confidence: number;
  tokenUsage?: { input: number; output: number };
  source?: 'llm' | 'template-fallback';
}

export interface VulnContextPack {
  finding: VulnFinding;
  stackGraph?: AgentStackGraphSlice;
  reproArtifacts?: {
    request?: unknown;
    response?: unknown;
    proxyDecision?: string;
    rule?: string;
    durationMs?: number;
  };
  scannerOutput?: string[];
  relatedTraffic?: Array<{ toolName: string; blocked: boolean; timestamp: string }>;
  sbomSlice?: Array<{ name: string; version: string }>;
  publishedIntel?: Array<{ id: string; summary: string }>;
  threatLabHistory?: string[];
  policyContext?: string[];
}

export interface AgentStackNode {
  id: string;
  kind: 'mcp_server' | 'tool' | 'upstream_api' | 'npm_package';
  name: string;
  meta?: Record<string, string>;
}

export interface AgentStackEdge {
  from: string;
  to: string;
  relation: 'hosts' | 'calls' | 'depends_on' | 'proxies';
}

export interface AgentStackGraph {
  nodes: AgentStackNode[];
  edges: AgentStackEdge[];
  generatedAt: string;
}

export interface AgentStackGraphSlice {
  nodes: AgentStackNode[];
  edges: AgentStackEdge[];
}

export interface VulnDiscoveryRunSummary {
  startedAt: string;
  finishedAt: string;
  findingsCreated: number;
  findingsValidated: number;
  scannersRun: string[];
  errors: string[];
}
