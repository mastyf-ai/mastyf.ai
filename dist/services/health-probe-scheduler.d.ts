/**
 * Optional periodic health probes for configured MCP servers.
 */
import type { IDatabase } from '../database/database-interface.js';
import type { McpServerConfig } from '../types.js';
export declare function startHealthProbeScheduler(db: IDatabase, servers: McpServerConfig[], tenantId?: string): void;
export declare function stopHealthProbeScheduler(): void;
//# sourceMappingURL=health-probe-scheduler.d.ts.map