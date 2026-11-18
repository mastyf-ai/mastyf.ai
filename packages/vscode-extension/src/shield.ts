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

  /** True when Shield's service answers with this PC's key (another program on the port doesn't count). */
  async answering(): Promise<boolean> {
    return (await this.status()) !== null;
  }

  /** Shield's own version (0.6 and later report it), or null. */
  async shieldVersion(): Promise<string | null> {
    const v = (await this.status())?.['shield_version'];
    return typeof v === 'string' && v ? v : null;
  }

  /** Shield's status answer: every Shield version says whether its gateway is available. */
  private async status(): Promise<Record<string, unknown> | null> {
    const body = await this.get('/api/gateway/status');
    return body && typeof body === 'object' && typeof (body as Record<string, unknown>)['available'] === 'boolean'
      ? (body as Record<string, unknown>)
      : null;
  }

  /** The newest records, newest first, or null when Shield isn't answering. */
  async receipts(limit: number): Promise<Receipt[] | null> {
    const body = await this.get(`/api/gateway/receipts?limit=${Math.max(1, Math.floor(limit))}`);
    const list = (body as { receipts?: unknown } | null)?.receipts;
    return Array.isArray(list) ? (list.filter((r) => r && typeof r === 'object') as Receipt[]) : null;
  }

  /**
   * The newest `want` blocked calls. Shield lists every call, so this pages back (newest first)
   * past allowed calls until it has enough blocks, reaches the end, or has looked at `maxScan` calls.
   */
  async recentBlocks(want: number, opts: { pageSize?: number; maxScan?: number } = {}): Promise<Receipt[] | null> {
    const pageSize = opts.pageSize ?? 100;
    const maxScan = opts.maxScan ?? 500;
    const blocks: Receipt[] = [];
    for (let offset = 0; offset < maxScan && blocks.length < want; offset += pageSize) {
      const limit = Math.min(pageSize, maxScan - offset);
      const body = await this.get(`/api/gateway/receipts?limit=${limit}&offset=${offset}`);
      const list = (body as { receipts?: unknown } | null)?.receipts;
      if (!Array.isArray(list)) return offset === 0 ? null : blocks;
      for (const r of list) if (r && typeof r === 'object' && (r as Receipt).decision === 'BLOCK') blocks.push(r as Receipt);
      if (list.length < limit) break;
    }
    return blocks.slice(0, want);
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
        redirect: 'error', // the key must never follow a redirect anywhere else
      });
      if (res.status !== 200) {
        void res.body?.cancel().catch(() => {}); // release the connection
        return null;
      }
      return await res.json();
    } catch {
      return null; // the error may quote the request, which carries the key
    } finally {
      clearTimeout(timer);
    }
  }
}
