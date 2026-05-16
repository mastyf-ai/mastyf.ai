import type { SecurityReport, CostReport, HealthReport, McpServerConfig } from '../types.js';
import type { PolicyAction } from '../policy/policy-types.js';

// ═══════════════════════════════════════════════════════════════
// Dependency Injection Interfaces (v2.3.5+)
// ═══════════════════════════════════════════════════════════════

export interface IHistoryDb {
  addSecurityScan(serverName: string, score: number, cveCount: number, data: unknown): Promise<void>;
  addCostRecord(serverName: string, tokensUsed: number, estimatedCostUSD: number): Promise<void>;
  addHealthCheck(serverName: string, latencyMs: number, success: boolean, toolCount: number): Promise<void>;
  getCallRecordsForServer(serverName: string): Promise<Record<string, unknown>[]>;
  getLatestSecurityScan(serverName: string): Promise<Record<string, unknown> | null>;
  getDistinctScannedServers(): Promise<string[]>;
  close(): void;
}

export interface ISecurityScanner {
  scanServer(server: McpServerConfig): Promise<SecurityReport>;
}

export interface ICveChecker {
  check(packageName: string, version?: string): Promise<import('../types.js').CveFinding[]>;
}

export interface ICostAuditor {
  auditServer(server: McpServerConfig): Promise<CostReport>;
  dispose(): void;
}

export interface IHealthMonitor {
  checkServer(server: McpServerConfig): Promise<HealthReport>;
}

export interface IPolicyEngine {
  evaluate(request: Record<string, unknown>): { action: PolicyAction; rule: string; reason: string };
  getMode(): string;
}

export interface Container {
  db: IHistoryDb;
  securityScanner: ISecurityScanner;
  costAuditor: ICostAuditor;
  healthMonitor: IHealthMonitor;
}