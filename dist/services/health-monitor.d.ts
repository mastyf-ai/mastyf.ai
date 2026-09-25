import { McpServerConfig, HealthReport } from '../types.js';
import { IDatabase } from '../database/database-interface.js';
export declare class HealthMonitor {
    private db;
    private tenantId?;
    constructor(db: IDatabase, tenantId?: string);
    checkServer(server: McpServerConfig, tenantId?: string): Promise<HealthReport>;
}
//# sourceMappingURL=health-monitor.d.ts.map