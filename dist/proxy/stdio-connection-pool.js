/**
 * Optional stdio worker pool for wrap mode (MASTYF_AI_STDIO_POOL_SIZE, default 1 = disabled).
 */
import { McpProxyServer } from './proxy-server.js';
import { Logger } from '../utils/logger.js';
export function stdioPoolSize() {
    const raw = process.env['MASTYF_AI_STDIO_POOL_SIZE'] || '1';
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1)
        return 1;
    return Math.min(n, 4);
}
export class StdioConnectionPool {
    command;
    args;
    env;
    db;
    serverName;
    policy;
    auth;
    registry;
    workers = [];
    next = 0;
    constructor(command, args, env, db, serverName, policy, auth, registry) {
        this.command = command;
        this.args = args;
        this.env = env;
        this.db = db;
        this.serverName = serverName;
        this.policy = policy;
        this.auth = auth;
        this.registry = registry;
    }
    async start() {
        const size = stdioPoolSize();
        for (let i = 0; i < size; i++) {
            const proxy = new McpProxyServer(this.command, this.args, this.env, this.db, `${this.serverName}${size > 1 ? `-${i}` : ''}`, this.policy, this.auth, 30000, 5, this.registry);
            this.workers.push(proxy);
        }
        if (this.workers.length > 1) {
            Logger.info(`[stdio-pool:${this.serverName}] Started ${this.workers.length} workers`);
        }
    }
    getPrimary() {
        return this.workers[0];
    }
    /** Round-robin handleClientInput across pool workers. */
    async handleClientInput(raw) {
        const worker = this.workers[this.next % this.workers.length];
        this.next++;
        await worker.handleClientInput(raw);
    }
    kill() {
        for (const w of this.workers)
            w.kill();
        this.workers = [];
    }
}
//# sourceMappingURL=stdio-connection-pool.js.map