import { IDatabase } from '../database/database-interface.js';
import { McpProxyServer } from './proxy-server.js';
import { StdioConnectionPool, stdioPoolSize } from './stdio-connection-pool.js';
import { SseProxyServer } from './sse-proxy-server.js';
import { WebSocketProxyServer } from './websocket-proxy-server.js';
import { assertGatewayStartup, isGatewayModeEnabled } from '../tenant/gateway-mode.js';
import { McpServerConfig } from '../types.js';
import { Logger } from '../utils/logger.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { PolicyWatcher } from '../policy/policy-watcher.js';
import { TenantPolicyRegistry } from '../policy/tenant-policy-registry.js';
import { OAuthValidator } from '../auth/oauth.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import * as Metrics from '../utils/metrics.js';

export class ProxyManager {
  private stdioProxies: McpProxyServer[] = [];
  private stdioPools: StdioConnectionPool[] = [];
  private sseProxies: Map<string, SseProxyServer> = new Map();
  private wsProxies: Map<string, WebSocketProxyServer> = new Map();
  private policyEngine: PolicyEngine | undefined;
  private tenantPolicyRegistry: TenantPolicyRegistry | undefined;

  constructor(
    private db: IDatabase,
    policyEngineOrWatcher?: PolicyEngine | PolicyWatcher,
    private authValidator?: OAuthValidator,
  ) {
    if (policyEngineOrWatcher instanceof PolicyWatcher) {
      this.policyEngine = policyEngineOrWatcher.get() ?? undefined;
      const updateEngine = () => {
        const newEngine = policyEngineOrWatcher!.get();
        if (newEngine) {
          this.policyEngine = newEngine;
          for (const proxy of this.stdioProxies) {
            proxy.setPolicyEngine(newEngine);
          }
          for (const pool of this.stdioPools) {
            pool.getPrimary().setPolicyEngine(newEngine);
          }
          Logger.info(`[proxy-manager] Policy hot-reloaded across ${this.stdioProxies.length} stdio + ${this.sseProxies.size} SSE proxy(s)`);
        }
      };
      (policyEngineOrWatcher as PolicyWatcher).onReload = updateEngine;
    } else {
      this.policyEngine = policyEngineOrWatcher ?? undefined;
    }
    if (this.policyEngine) {
      this.tenantPolicyRegistry = new TenantPolicyRegistry(this.policyEngine);
    }
  }

  getProxies(): McpProxyServer[] {
    if (this.stdioPools.length > 0) {
      return this.stdioPools.map((p) => p.getPrimary());
    }
    return this.stdioProxies;
  }

  /** Primary stdio handler — pool round-robin or single proxy. */
  async dispatchStdioInput(raw: string): Promise<void> {
    if (this.stdioPools.length === 1) {
      await this.stdioPools[0]!.handleClientInput(raw);
      return;
    }
    if (this.stdioProxies.length === 1) {
      await this.stdioProxies[0]!.handleClientInput(raw);
    }
  }

  /** Returns summary counts for the CLI proxy command output */
  getProxyStats(): { stdioCount: number; sseCount: number; wsCount: number } {
    return {
      stdioCount: this.stdioProxies.length,
      sseCount: this.sseProxies.size,
      wsCount: this.wsProxies.size,
    };
  }

  async startAll(configs: McpServerConfig[]): Promise<void> {
    const gateway = isGatewayModeEnabled();
    if (gateway) assertGatewayStartup();

    const stdioServers = gateway
      ? []
      : configs.filter((c) => c.command && c.transport !== 'websocket');
    const sseServers = configs.filter(
      (c) => !c.command && (c.transport === 'sse' || (!c.transport && c.url)),
    );
    const wsServers = configs.filter((c) => c.transport === 'websocket' && c.url);

    let stdioStarted = 0;
    let sseStarted = 0;
    let wsStarted = 0;

    // ─── Stdio proxies ─────────────────────────────────────
    for (const config of stdioServers) {
      try {
        const sanitizedEnv: Record<string, string> = {
          ...(config.env || {}),
          PATH: process.env['PATH'] || '',
          HOME: process.env['HOME'] || '',
        };
        if (stdioPoolSize() > 1) {
          const pool = new StdioConnectionPool(
            config.command!,
            config.args || [],
            sanitizedEnv,
            this.db,
            config.name,
            this.policyEngine,
            this.authValidator,
            this.tenantPolicyRegistry,
          );
          await pool.start();
          this.stdioPools.push(pool);
        } else {
          const proxy = new McpProxyServer(
            config.command!, config.args || [], sanitizedEnv,
            this.db, config.name, this.policyEngine, this.authValidator,
            30000, 5, this.tenantPolicyRegistry,
          );
          this.stdioProxies.push(proxy);
        }
        stdioStarted++;
        Logger.info(`[proxy] stdio active for "${config.name}" → ${config.command}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        Logger.error(`[proxy] FAILED stdio for "${config.name}": ${message}`);
      }
    }

    // ─── SSE/HTTP proxies — NEW: actually spawn them ──────
    for (const config of sseServers) {
      try {
        const url = config.url;
        if (!url) {
          Logger.warn(`[proxy] SKIPPED SSE server "${config.name}" — no URL configured. Add 'url' to mcp.json.`);
          continue;
        }
        const authHeader = config.env?.['AUTH_TOKEN']
          ? `Bearer ${config.env['AUTH_TOKEN']}`
          : undefined;
        const sseProxy = new SseProxyServer({
          upstreamUrl: url,
          serverName: config.name,
          policy: this.policyEngine,
          db: this.db,
          authHeader,
          listenPort: parseInt(config.env?.['MASTYF_AI_SSE_PROXY_PORT'] || '0', 10) || 0,
        });
        sseProxy.on('blocked', ({ reason }) => {
          Logger.warn(`[proxy][${config.name}] BLOCKED: ${reason}`);
        });
        const listenPort = await sseProxy.start();
        this.sseProxies.set(config.name, sseProxy);
        sseStarted++;
        Metrics.sseUntrackedServers.set({ server_name: config.name }, 0);
        StructuredLogger.info({
          event: 'sse_proxy_listening',
          serverName: config.name,
          upstreamUrl: url,
          listenPort,
          message: `Point MCP client at http://127.0.0.1:${listenPort}/sse (GET) + /message (POST)`,
        });
        Logger.info(`[proxy] SSE active for "${config.name}" → ${url} (local :${listenPort})`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        Logger.error(`[proxy] FAILED SSE for "${config.name}": ${message}`);
      }
    }

    for (const config of wsServers) {
      try {
        const url = config.url;
        if (!url) {
          Logger.warn(`[proxy] SKIPPED WebSocket "${config.name}" — no url`);
          continue;
        }
        const listenPort = parseInt(
          config.env?.['MASTYF_AI_WS_PROXY_PORT'] || config.env?.['MASTYF_AI_SSE_PROXY_PORT'] || '0',
          10,
        ) || 0;
        const wsProxy = new WebSocketProxyServer({
          listenPort: listenPort > 0 ? listenPort : 0,
          upstreamWsUrl: url,
          serverName: config.name,
          policy: this.policyEngine,
          db: this.db,
          authValidator: this.authValidator,
        });
        const boundPort = await wsProxy.start();
        this.wsProxies.set(config.name, wsProxy);
        wsStarted++;
        Logger.info(
          `[proxy] WebSocket active for "${config.name}" → ${url} (local ws://127.0.0.1:${boundPort})`,
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        Logger.error(`[proxy] FAILED WebSocket for "${config.name}": ${message}`);
      }
    }

    // ─── Summary — loud and clear ═══════════════════════════
    const total = stdioStarted + sseStarted + wsStarted;
    const skipped = configs.length - total;

    if (total === 0) {
      Logger.error(
        '╔══════════════════════════════════════════════════════════╗\n' +
        '║  ZERO PROXIES STARTED — NO PROTECTION ACTIVE             ║\n' +
        '╠══════════════════════════════════════════════════════════╣\n' +
        '║  All configured servers were skipped.                    ║\n' +
        '║  Check command (stdio) or url (SSE/WS) in MCP config.   ║\n' +
        '╚══════════════════════════════════════════════════════════╝'
      );
      return;
    }

    Logger.info(
      `╔══════════════════════════════════════════╗\n` +
      `║  MCP Mastyf AI Proxy — Protection Active  ║\n` +
      `╠══════════════════════════════════════════╣\n` +
      `║  Stdio: ${String(stdioStarted).padStart(4)} servers              ║\n` +
      `║  SSE:   ${String(sseStarted).padStart(4)} servers              ║\n` +
      `║  WS:    ${String(wsStarted).padStart(4)} servers              ║\n` +
      `║  Total: ${String(total).padStart(4)} servers protected        ║`
    );

    if (skipped > 0) {
      const startedNames = new Set<string>();
      for (const p of this.stdioProxies) startedNames.add(p['serverName'] as string);
      for (const [name] of this.sseProxies) startedNames.add(name);
      for (const [name] of this.wsProxies) startedNames.add(name);
      const skippedNames = configs.filter(c => !startedNames.has(c.name)).map(c => c.name);
      Logger.warn(
        `║  ⚠  SKIPPED: ${String(skipped).padStart(2)} server(s)              ║\n` +
        `║     ${skippedNames.join(', ').substring(0, 40)}${skippedNames.join(', ').length > 40 ? '…' : ''}`
      );
    }

    const policyMsg = this.policyEngine
      ? `║  Policy: ${this.policyEngine.getMode().padEnd(8)}                    ║\n`
      : '║  Policy: audit-only (no --policy flag)      ║\n';

    Logger.info(
      `║                                          ║\n` +
      policyMsg +
      `╚══════════════════════════════════════════╝`
    );
  }

  async reloadServers(configs: McpServerConfig[]): Promise<void> {
    Logger.info('[proxy-manager] Hot-reloading server configs…');
    await this.stopAll();
    await this.startAll(configs);
    Logger.info('[proxy-manager] Server configs hot-reloaded');
  }

  async stopAll(): Promise<void> {
    for (const proxy of this.stdioProxies) {
      proxy.kill();
    }
    this.stdioProxies = [];
    for (const pool of this.stdioPools) {
      pool.kill();
    }
    this.stdioPools = [];
    for (const [name, sseProxy] of this.sseProxies) {
      Metrics.sseUntrackedServers.set({ server_name: name }, 0);
      sseProxy.removeAllListeners();
      await sseProxy.stop();
    }
    this.sseProxies.clear();
    for (const [, wsProxy] of this.wsProxies) {
      await wsProxy.stop();
    }
    this.wsProxies.clear();
    Logger.info('All proxies stopped');
  }
}
