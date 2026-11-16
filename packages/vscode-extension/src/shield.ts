/**
 * Reads from the Shield app's local service on this PC. The key is Shield's own key file, read for
 * each request and kept only for that request. It goes to 127.0.0.1 and nowhere else, and it never
 * appears in a result, an error or a log line.
 */

export interface Receipt {
  receipt_id?: string;
  request_id?: string;
  timestamp_utc?: string;
  tool_name?: string;
  server_name?: string;
  caller_agent?: string;
  decision?: string;
  reason_code?: string;
  enforcement_reason?: string;
  block_layer?: string;
  block_match?: string;
  block_field?: string;
  block_confidence?: number;
}

export interface ShieldClientOptions {
  port: number;
  readKey: () => string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class ShieldClient {
  private readonly port: number;
  private readonly readKey: () => string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: ShieldClientOptions) {
    this.port = opts.port;
    this.readKey = opts.readKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 3000;
  }

  /** True when Shield's service answers with this PC's key. */
  async answering(): Promise<boolean> {
    return (await this.get('/api/gateway/status')) !== null;
  }

  /** The newest records, newest first, or null when Shield isn't answering. */
  async receipts(limit: number): Promise<Receipt[] | null> {
    const body = await this.get(`/api/gateway/receipts?limit=${Math.max(1, Math.floor(limit))}`);
    const list = (body as { receipts?: unknown } | null)?.receipts;
    return Array.isArray(list) ? (list.filter((r) => r && typeof r === 'object') as Receipt[]) : null;
  }

  /** GET a JSON body, or null on no key, timeout, a non-200 answer or a body that isn't JSON. */
  private async get(path: string): Promise<unknown> {
    const key = this.readKey();
    if (!key) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`http://127.0.0.1:${this.port}${path}`, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (res.status !== 200) return null;
      return await res.json();
    } catch {
      return null; // the error may quote the request, which carries the key
    } finally {
      clearTimeout(timer);
    }
  }
}
