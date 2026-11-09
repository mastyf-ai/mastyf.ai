/**
 * Optional stdio worker pool for wrap mode (MASTYF_AI_STDIO_POOL_SIZE, default 1 = disabled).
 */
import { McpProxyServer } from './proxy-server.js';
import type { IDatabase } from '../database/database-interface.js';
import type { PolicyEngine } from '../policy/policy-engine.js';
import type { OAuthValidator } from '../auth/oauth.js';
import type { TenantPolicyRegistry } from '../policy/tenant-policy-registry.js';
import { Logger } from '../utils/logger.js';

export function stdioPoolSize(): number {
  const raw = process.env['MASTYF_AI_STDIO_POOL_SIZE'] || '1';
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 4);
}

export class StdioConnectionPool {
  private workers: McpProxyServer[] = [];
  private next = 0;

  constructor(
    private command: string,
    private args: string[],
    private env: Record<string, string>,
    private db: IDatabase,
    private serverName: string,
    private policy?: PolicyEngine,
    private auth?: OAuthValidator,
    private registry?: TenantPolicyRegistry,
  ) {}

  async start(): Promise<void> {
    const size = stdioPoolSize();
    for (let i = 0; i < size; i++) {
      const proxy = new McpProxyServer(
        this.command,
        this.args,
        this.env,
        this.db,
        `${this.serverName}${size > 1 ? `-${i}` : ''}`,
        this.policy,
        this.auth,
        30000,
        5,
        this.registry,
      );
      this.workers.push(proxy);
    }
    if (this.workers.length > 1) {
      Logger.info(`[stdio-pool:${this.serverName}] Started ${this.workers.length} workers`);
    }
  }

  getPrimary(): McpProxyServer {
    return this.workers[0]!;
  }

  /** Round-robin handleClientInput across pool workers. */
  async handleClientInput(raw: string, source?: { localStdio?: boolean }): Promise<void> {
    const worker = this.workers[this.next % this.workers.length]!;
    this.next++;
    await worker.handleClientInput(raw, source);
  }

  kill(): void {
    for (const w of this.workers) w.kill();
    this.workers = [];
  }
}
