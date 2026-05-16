import { HistoryDatabase } from '../database/history-db.js';
import { McpProxyServer } from './proxy-server.js';
import { SseProxyServer } from './sse-proxy-server.js';
import { McpServerConfig } from '../types.js';
import { Logger } from '../utils/logger.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { PolicyWatcher } from '../policy/policy-watcher.js';
import { OAuthValidator } from '../auth/oauth.js';
import { StructuredLogger } from '../utils/structured-logger.js';

export class ProxyManager {
  private stdioProxies: McpProxyServer[] = [];
  private sseProxies: Map<string, SseProxyServer> = new Map();
  private policyEngine: PolicyEngine | undefined;

  constructor(
    private db: HistoryDatabase,
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
          Logger.info(`[proxy-manager] Policy hot-reloaded across ${this.stdioProxies.length} stdio + ${this.sseProxies.size} SSE proxy(s)`);
        }
      };
      (policyEngineOrWatcher as PolicyWatcher).onReload = updateEngine;
    } else {
      this.policyEngine = policyEngineOrWatcher ?? undefined;
    }
  }

  getProxies(): McpProxyServer[] {
    return this.stdioProxies;
  }

  /** Returns summary counts for the CLI proxy command output */
  getProxyStats(): { stdioCount: number; sseCount: number } {
    return { stdioCount: this.stdioProxies.length, sseCount: this.sseProxies.size };
  }

  async startAll(configs: McpServerConfig[]): Promise<void> {
const stdioServers = configs.filter((c) => c.command);
const sseServers = configs.filter((c) => !c.command && (c.transport === 'sse' || c.url));

    let stdioStarted = 0;
    let sseStarted = 0;

    // ─── Stdio proxies ─────────────────────────────────────
    for (const config of stdioServers) {
      try {
        const sanitizedEnv: Record<string, string> = {
          ...(config.env || {}),
          PATH: process.env['PATH'] || '',
          HOME: process.env['HOME'] || '',
        };
        const proxy = new McpProxyServer(
          config.command!, config.args || [], sanitizedEnv,
          this.db, config.name, this.policyEngine, this.authValidator,
        );
        this.stdioProxies.push(proxy);
        stdioStarted++;
        Logger.info(`[proxy] stdio active for "${config.name}" → ${config.command}`);
      } catch (err: any) {
        Logger.error(`[proxy] FAILED stdio for "${config.name}": ${err?.message}`);
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
        });
        sseProxy.on('blocked', ({ reason }) => {
          Logger.warn(`[proxy][${config.name}] BLOCKED: ${reason}`);
        });
        this.sseProxies.set(config.name, sseProxy);
        sseStarted++;
        Logger.info(`[proxy] SSE active for "${config.name}" → ${url}`);
      } catch (err: any) {
        Logger.error(`[proxy] FAILED SSE for "${config.name}": ${err?.message}`);
      }
    }

    // ─── Summary — loud and clear ═══════════════════════════
    const total = stdioStarted + sseStarted;
    const skipped = configs.length - total;

    if (total === 0) {
      Logger.error(
        '╔══════════════════════════════════════════════════════════╗\n' +
        '║  ZERO PROXIES STARTED — NO PROTECTION ACTIVE             ║\n' +
        '╠══════════════════════════════════════════════════════════╣\n' +
        '║  All configured servers were skipped.                    ║\n' +
        '║  Check that each server has "command" (stdio) or         ║\n' +
        '║  "url" (SSE/HTTP) in your MCP config.                   ║\n' +
        '╚══════════════════════════════════════════════════════════╝'
      );
      return;
    }

    Logger.info(
      `╔══════════════════════════════════════════╗\n` +
      `║  MCP Guardian Proxy — Protection Active  ║\n` +
      `╠══════════════════════════════════════════╣\n` +
      `║  Stdio: ${String(stdioStarted).padStart(4)} servers              ║\n` +
      `║  SSE:   ${String(sseStarted).padStart(4)} servers              ║\n` +
      `║  Total: ${String(total).padStart(4)} servers protected        ║`
    );

    if (skipped > 0) {
      const startedNames = new Set<string>();
      for (const p of this.stdioProxies) startedNames.add(p['serverName'] as string);
      for (const [name] of this.sseProxies) startedNames.add(name);
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

  stopAll(): void {
    for (const proxy of this.stdioProxies) {
      proxy.kill();
    }
    this.stdioProxies = [];
    for (const [, sseProxy] of this.sseProxies) {
      sseProxy.removeAllListeners();
    }
    this.sseProxies.clear();
    Logger.info('All proxies stopped');
  }
}
