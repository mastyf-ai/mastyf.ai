/**
 * Optional stdio worker pool for wrap mode (MASTYF_AI_STDIO_POOL_SIZE, default 1 = disabled).
 */
import { McpProxyServer } from './proxy-server.js';
import type { IDatabase } from '../database/database-interface.js';
import type { PolicyEngine } from '../policy/policy-engine.js';
import type { OAuthValidator } from '../auth/oauth.js';
import type { TenantPolicyRegistry } from '../policy/tenant-policy-registry.js';
export declare function stdioPoolSize(): number;
export declare class StdioConnectionPool {
    private command;
    private args;
    private env;
    private db;
    private serverName;
    private policy?;
    private auth?;
    private registry?;
    private workers;
    private next;
    constructor(command: string, args: string[], env: Record<string, string>, db: IDatabase, serverName: string, policy?: PolicyEngine | undefined, auth?: OAuthValidator | undefined, registry?: TenantPolicyRegistry | undefined);
    start(): Promise<void>;
    getPrimary(): McpProxyServer;
    /** Round-robin handleClientInput across pool workers. */
    handleClientInput(raw: string): Promise<void>;
    kill(): void;
}
//# sourceMappingURL=stdio-connection-pool.d.ts.map