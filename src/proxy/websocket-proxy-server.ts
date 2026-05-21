/**
 * WebSocket MCP transport proxy — policy, auth, circuit breaker, audit parity with stdio.
 */
import { createServer, type IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createHash, randomUUID } from 'crypto';
import { PolicyEngine } from '../policy/policy-engine.js';
import { Logger } from '../utils/logger.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import {
  InvalidTenantIdError,
} from '../tenant/resolve-tenant.js';
import {
  JwtTenantRequiredError,
  resolveProxyTenantId,
} from '../tenant/jwt-tenant-binding.js';
import type { CallContext } from '../policy/policy-types.js';
import type { IDatabase } from '../database/database-interface.js';
import { OAuthValidator } from '../auth/oauth.js';
import { extractDpopProof, validateRequiredDpop } from '../auth/dpop-enforcement.js';
import { getCircuitBreaker } from '../utils/circuit-breaker-registry.js';
import { scanForSecrets } from '../scanners/secret-scanner.js';
import { inspectFullResponse, isResponseScanSkipped } from '../utils/streaming-inspector.js';
import { persistCallRecord } from '../utils/call-record-cost.js';
import { idempotencyKeyFromRequest } from '../policy/idempotency-store.js';
import type { AgentIdentity } from '../auth/auth-types.js';
import { sanitizeProxyClientError, webSocketClientOptions } from '../utils/ws-tls-config.js';

export interface WebSocketProxyOptions {
  listenPort: number;
  upstreamWsUrl: string;
  serverName: string;
  policy?: PolicyEngine;
  db?: IDatabase;
  authValidator?: OAuthValidator;
}

export class WebSocketProxyServer {
  private opts: WebSocketProxyOptions;
  private httpServer: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;
  private toolFingerprint: string | null = null;
  private rugPullBlocked = false;

  constructor(opts: WebSocketProxyOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    this.httpServer = createServer();
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (clientWs, req) => {
      void this.handleClientConnection(clientWs, req);
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.once('error', reject);
      this.httpServer!.listen(this.opts.listenPort, () => {
        this.httpServer!.removeListener('error', reject);
        Logger.info(
          `[ws-proxy:${this.opts.serverName}] Listening on ws://0.0.0.0:${this.opts.listenPort} → ${this.opts.upstreamWsUrl}`,
        );
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.wss?.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      this.httpServer?.close(() => resolve());
    });
  }

  private breakerFor(tenantId: string) {
    return getCircuitBreaker(tenantId, this.opts.serverName);
  }

  private fingerprintToolsList(result: unknown): string {
    return createHash('sha256').update(JSON.stringify(result ?? {})).digest('hex');
  }

  private async handleClientConnection(clientWs: WebSocket, req: IncomingMessage): Promise<void> {
    const upstream = new WebSocket(
      this.opts.upstreamWsUrl,
      undefined,
      webSocketClientOptions(this.opts.upstreamWsUrl),
    );

    upstream.on('open', () => {
      clientWs.on('message', (data) => {
        void this.interceptMessage(data, clientWs, upstream, req);
      });
      upstream.on('message', (data) => {
        void this.interceptUpstreamMessage(data, clientWs);
      });
    });

    upstream.on('error', (err) => {
      Logger.warn(`[ws-proxy:${this.opts.serverName}] upstream error: ${err.message}`);
      clientWs.close(1011, sanitizeProxyClientError('upstream error'));
    });

    clientWs.on('close', () => upstream.close());
    upstream.on('close', () => clientWs.close());
    clientWs.on('error', () => upstream.close());
  }

  private async interceptUpstreamMessage(data: WebSocket.RawData, clientWs: WebSocket): Promise<void> {
    const raw = typeof data === 'string' ? data : data.toString('utf-8');
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(raw);
      return;
    }

    if (msg.method === 'tools/list' && msg.result) {
      const hash = this.fingerprintToolsList(msg.result);
      if (!this.toolFingerprint) {
        this.toolFingerprint = hash;
      } else if (this.toolFingerprint !== hash) {
        this.rugPullBlocked = true;
        Logger.warn(`[ws-proxy:${this.opts.serverName}] Rug-pull: tools/list fingerprint changed`);
      }
    }

    if (msg.result && typeof msg.id !== 'undefined') {
      const blocked = this.inspectToolResult(msg);
      if (blocked) {
        clientWs.send(JSON.stringify(blocked));
        return;
      }
    }

    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(raw);
  }

  private inspectToolResult(msg: Record<string, unknown>): Record<string, unknown> | null {
    if (!this.opts.policy || this.opts.policy.getMode() !== 'block' || isResponseScanSkipped()) {
      return null;
    }
    const resultText = JSON.stringify((msg as { result?: unknown }).result ?? '');
    const inspect = inspectFullResponse(resultText, {
      toolName: 'response',
      serverName: this.opts.serverName,
      policy: this.opts.policy,
    });
    if (!inspect.hasCritical && !inspect.hasHigh) return null;
    return {
      jsonrpc: '2.0',
      id: msg.id,
      error: {
        code: -32001,
        message: 'Blocked: prompt injection detected in tool response',
      },
    };
  }

  private async interceptMessage(
    data: WebSocket.RawData,
    clientWs: WebSocket,
    upstream: WebSocket,
    req: IncomingMessage,
  ): Promise<void> {
    const raw = typeof data === 'string' ? data : data.toString('utf-8');
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(raw);
      return;
    }

    if (msg.method === 'tools/call') {
      if (this.rugPullBlocked) {
        clientWs.send(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32001, message: 'Blocked: tool definitions changed mid-session (rug-pull)' },
        }));
        return;
      }

      const blocked = await this.evaluateToolCall(msg, req);
      if (blocked) {
        clientWs.send(JSON.stringify(blocked));
        return;
      }
    }

    if (upstream.readyState === WebSocket.OPEN) upstream.send(raw);
  }

  private async evaluateToolCall(
    msg: Record<string, unknown>,
    req: IncomingMessage,
  ): Promise<Record<string, unknown> | null> {
    if (!this.opts.policy) return null;

    let tenantId: string;
    let agentIdentity: AgentIdentity | undefined;
    let authenticated = false;
    const authHeader = req.headers['authorization'];
    const token = OAuthValidator.extractToken(
      typeof authHeader === 'string' ? authHeader : authHeader?.[0],
    );

    if (token && this.opts.authValidator) {
      const result = await this.opts.authValidator.validate(token);
      if (result.valid && result.identity) {
        authenticated = true;
        agentIdentity = result.identity;
      } else if (this.opts.authValidator.getConfig().required) {
        return {
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32002, message: result.error || 'Authentication required' },
        };
      }
    }

    try {
      tenantId = resolveProxyTenantId({
        headers: req.headers as Record<string, string | string[] | undefined>,
        meta: (msg.params as Record<string, unknown> | undefined)?._meta,
        jwtTenantId: agentIdentity?.tenantId,
        authenticated,
      });
    } catch (err) {
      if (err instanceof InvalidTenantIdError || err instanceof JwtTenantRequiredError) {
        return { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: err.message } };
      }
      throw err;
    }

    const breaker = this.breakerFor(tenantId);
    if (!breaker.allowRequest()) {
      return {
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32005, message: 'Upstream unavailable — circuit breaker open' },
      };
    }

    if (token) {
      const dpopCheck = await validateRequiredDpop(
        extractDpopProof({ headerDpop: req.headers['dpop'] }),
        'POST',
        `wss://${this.opts.serverName}/tools/call`,
        token,
        tenantId,
        this.opts.policy.getMode(),
      );
      if (!dpopCheck.valid) {
        breaker.recordFailure();
        return {
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32004, message: dpopCheck.error || 'DPoP validation failed' },
        };
      }
    }

    const params = msg.params as {
      name?: string;
      arguments?: Record<string, unknown>;
      _meta?: Record<string, unknown>;
    } | undefined;

    if (params?.arguments) {
      const secrets = scanForSecrets(JSON.stringify(params.arguments), `ws:${this.opts.serverName}`);
      if (secrets.length > 0 && this.opts.policy.getMode() === 'block') {
        breaker.recordFailure();
        return {
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32001, message: 'Blocked: secrets detected in tool arguments' },
        };
      }
    }

    const context: CallContext = {
      serverName: this.opts.serverName,
      toolName: params?.name || 'unknown',
      arguments: params?.arguments,
      requestId: String(msg.id ?? randomUUID()),
      requestTokens: JSON.stringify(msg).length,
      timestamp: new Date().toISOString(),
      tenantId,
      agentIdentity,
      idempotencyKey: idempotencyKeyFromRequest(params?._meta),
    };

    const decision = await this.opts.policy.evaluateAsync(context);
    if (decision.action === 'block') {
      breaker.recordFailure();
      StructuredLogger.logBlocked({
        event: 'tool_blocked',
        requestId: context.requestId,
        serverName: this.opts.serverName,
        toolName: context.toolName,
        reason: decision.reason,
        rule: decision.rule,
      });
      return {
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32001, message: `Blocked by MCP Guardian policy: ${decision.reason}` },
      };
    }

    breaker.recordSuccess();

    if (this.opts.db) {
      persistCallRecord(
        this.opts.db,
        {
          serverName: this.opts.serverName,
          toolName: context.toolName,
          timestamp: context.timestamp,
          requestTokens: context.requestTokens,
          responseTokens: 0,
          totalTokens: context.requestTokens,
          durationMs: 0,
          tenantId,
        },
        msg,
      ).catch(() => undefined);
    }

    return null;
  }
}
