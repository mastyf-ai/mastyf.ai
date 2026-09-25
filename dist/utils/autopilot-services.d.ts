/**
 * Start Autopilot background services (scheduler, reports).
 */
import type { IDatabase } from '../database/database-interface.js';
import type { McpServerConfig } from '../types.js';
export declare function startAutopilotServices(historyDb: IDatabase, tenantId?: string, servers?: McpServerConfig[]): void;
//# sourceMappingURL=autopilot-services.d.ts.map