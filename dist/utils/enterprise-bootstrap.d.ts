import { PolicyAuditor } from './policy-auditor.js';
import { ExporterManager } from '../exporters/exporter-manager.js';
import { AuditTrailSync } from '../aggregator/audit-trail-sync.js';
import { IDatabase } from '../database/database-interface.js';
import type { PolicyWatcher } from '../policy/policy-watcher.js';
export declare function bootstrapSecrets(): Promise<void>;
export declare function bootstrapCompliance(db: IDatabase): Promise<void>;
/** Startup warnings for production security posture (mcp tests 31 §3.5 / §3.1). */
export declare function isMultiReplicaDeployment(): boolean;
export declare function runEnterpriseSecurityPreflight(): void;
export declare function bootstrapControlPlane(policyWatcher?: PolicyWatcher | null): Promise<void>;
/** Start mTLS cert watcher and prime shared HTTPS agent for HTTP/SSE proxies. */
export declare function bootstrapMtlsHotReload(): void;
export declare function getPolicyAuditor(): PolicyAuditor | null;
export declare function getAuditTrailSync(): AuditTrailSync | null;
export declare function getExporterManager(): ExporterManager | null;
export declare function shutdownEnterprise(): Promise<void>;
export declare function exportSiemEvent(type: string, payload: Record<string, unknown>): Promise<void>;
//# sourceMappingURL=enterprise-bootstrap.d.ts.map