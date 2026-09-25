import { IDatabase } from '../database/database-interface.js';
import { McpProxyServer } from './proxy-server.js';
import { McpServerConfig } from '../types.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { PolicyWatcher } from '../policy/policy-watcher.js';
import { OAuthValidator } from '../auth/oauth.js';
export declare class ProxyManager {
    private db;
    private authValidator?;
    private stdioProxies;
    private stdioPools;
    private sseProxies;
    private streamableProxies;
    private wsProxies;
    private policyEngine;
    private tenantPolicyRegistry;
    constructor(db: IDatabase, policyEngineOrWatcher?: PolicyEngine | PolicyWatcher, authValidator?: OAuthValidator | undefined);
    getProxies(): McpProxyServer[];
    /** Primary stdio handler — pool round-robin or single proxy. */
    dispatchStdioInput(raw: string): Promise<void>;
    /** Returns summary counts for the CLI proxy command output */
    getProxyStats(): {
        stdioCount: number;
        sseCount: number;
        streamableCount: number;
        wsCount: number;
    };
    startAll(configs: McpServerConfig[]): Promise<void>;
    reloadServers(configs: McpServerConfig[]): Promise<void>;
    stopAll(): Promise<void>;
}
//# sourceMappingURL=proxy-manager.d.ts.map