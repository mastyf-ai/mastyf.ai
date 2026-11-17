/**
 * The HTTP check API. Listens on 127.0.0.1 by default. Every request except GET /v1/health needs the
 * local token. An error of the service's own is a 500, never an "allow"; each client decides what
 * a 500 means (block, by default).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CheckEngine, ToolDef, Verdict } from './engine';

export const VERSION = '0.1.0';
const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_DEPTH = 64;
const BLOCKS_KEPT = 200;

export type Log = (line: string) => void;

export interface ServerOptions {
  host: string;
  port: number;
  token: string;
  log: Log;
  /** Largest request body accepted; default 2 MB. */
  maxBodyBytes?: number;
}

interface BlockRecord extends Verdict {
  at: string;
  kind: 'call' | 'result' | 'tools';
  tool?: string;
  server?: string;
  session?: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function depthOf(value: unknown, depth = 0): number {
  if (depth > MAX_DEPTH) return depth;
  if (Array.isArray(value)) return Math.max(depth, ...value.map((v) => depthOf(v, depth + 1)));
  if (value && typeof value === 'object') return Math.max(depth, ...Object.values(value).map((v) => depthOf(v, depth + 1)));
  return depth;
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new HttpError(413, `body over ${Math.round(maxBytes / 1024 / 1024)} MB`);
    chunks.push(chunk as Buffer);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'body is not JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, 'body must be a JSON object');
  if (depthOf(parsed) > MAX_DEPTH) throw new HttpError(400, `body is nested deeper than ${MAX_DEPTH} levels`);
  return parsed as Record<string, unknown>;
}

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const optionalString = (body: Record<string, unknown>, field: string): string | undefined => {
  const v = body[field];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new HttpError(400, `"${field}" must be a string`);
  return v;
};
function requiredTool(body: Record<string, unknown>): string {
  const v = body['tool'];
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, '"tool" is required and must be a non-empty string');
  return v;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

export function tokenMatches(header: string | undefined, token: string): boolean {
  // No regex: "Bearer\s+(.+)" backtracks quadratically on a header of many spaces or tabs.
  const h = header ?? '';
  if (h.slice(0, 6).toLowerCase() !== 'bearer' || !/^\s$/.test(h.charAt(6))) return false;
  const presented = h.slice(7).trim();
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function startServer(engine: CheckEngine, opts: ServerOptions): Promise<{ url: string; close(): Promise<void> }> {
  const blocks: BlockRecord[] = [];
  const remember = (kind: BlockRecord['kind'], v: Verdict, extra: Partial<BlockRecord>): Verdict => {
    if (v.decision === 'block') {
      const { result: _result, ...rest } = v;
      blocks.unshift({ ...rest, ...extra, kind, at: new Date().toISOString() });
      if (blocks.length > BLOCKS_KEPT) blocks.length = BLOCKS_KEPT;
    }
    return v;
  };
  // One line per decision; never argument values, results, matched text or the token.
  const logDecision = (kind: string, v: Verdict, tool?: string) =>
    opts.log(JSON.stringify({ at: new Date().toISOString(), kind, tool, decision: v.decision, layer: v.layer, rule: v.rule, id: v.id }));

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/v1/health') {
      // A client can check this service knows the token before sending it anything: it sends a
      // random nonce and compares the HMAC. The token itself never travels on this route.
      const nonce = url.searchParams.get('nonce');
      const proof = nonce && /^[A-Za-z0-9_-]{16,128}$/.test(nonce) ? createHmac('sha256', opts.token).update(nonce).digest('hex') : undefined;
      const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES; // lets a client refuse oversize input before sending it
      return send(res, 200, { status: 'ready', tier: 'free', version: VERSION, rules: engine.ruleCount(), maxBodyBytes, ...(proof ? { proof } : {}) });
    }
    if (!tokenMatches(req.headers['authorization'], opts.token)) return send(res, 401, { error: 'missing or wrong token' });

    if (req.method === 'GET' && url.pathname === '/v1/blocks') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), BLOCKS_KEPT);
      return send(res, 200, { blocks: blocks.slice(0, limit) });
    }
    if (req.method !== 'POST') return send(res, 404, { error: 'not found' });

    const body = await readBody(req, opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
    switch (url.pathname) {
      case '/v1/check/call': {
        const tool = requiredTool(body);
        const args = body['arguments'] ?? {};
        if (!isObject(args)) throw new HttpError(400, '"arguments" must be an object');
        const input = { tool, arguments: args, server: optionalString(body, 'server'), agent: optionalString(body, 'agent'), session: optionalString(body, 'session') };
        const v = await engine.checkCall(input);
        logDecision('call', v, tool);
        return send(res, 200, remember('call', v, { tool, server: input.server, session: input.session }));
      }
      case '/v1/check/result': {
        const tool = requiredTool(body);
        if (!('result' in body)) throw new HttpError(400, '"result" is required');
        const args = body['arguments'];
        if (args !== undefined && !isObject(args)) throw new HttpError(400, '"arguments" must be an object');
        const includeMatch = body['includeMatch'] === true;
        const input = { tool, result: body['result'], arguments: args, includeMatch, server: optionalString(body, 'server'), agent: optionalString(body, 'agent'), session: optionalString(body, 'session') };
        const v = await engine.checkResult(input);
        logDecision('result', v, tool);
        return send(res, 200, remember('result', v, { tool, server: input.server, session: input.session }));
      }
      case '/v1/tools': {
        const server = optionalString(body, 'server');
        if (!server) throw new HttpError(400, '"server" is required');
        const tools = body['tools'];
        if (!Array.isArray(tools) || tools.some((t) => !isObject(t) || typeof t['name'] !== 'string')) {
          throw new HttpError(400, '"tools" must be a list of { name, description?, inputSchema? }');
        }
        const session = optionalString(body, 'session');
        const changed = engine.registerTools(server, tools as unknown as ToolDef[], session);
        // Descriptions and schemas reach the model too: checked like a tool result, as the proxy does.
        const poisoned = changed ? null : await engine.checkResult({ tool: 'tools/list', result: { tools }, server, session });
        // A redact verdict comes back with the cleaned tool list, as the proxy forwards it.
        const v: Verdict = changed ?? (poisoned && poisoned.decision !== 'allow' ? poisoned : { decision: 'allow', id: 'tools' });
        logDecision('tools', v);
        return send(res, 200, remember('tools', v, { server, session }));
      }
      default:
        return send(res, 404, { error: 'not found' });
    }
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (err instanceof HttpError) {
        if (err.status === 413) {
          // The rest of the body is never read: close the connection after answering, or a client
          // still uploading would wait forever for us to read it.
          res.setHeader('connection', 'close');
          res.once('finish', () => req.destroy());
        }
        return send(res, err.status, { error: err.message });
      }
      opts.log(JSON.stringify({ at: new Date().toISOString(), kind: 'error', message: err instanceof Error ? err.message : String(err) }));
      send(res, 500, { error: 'the check failed; treat the call as not checked' });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${opts.host}:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
