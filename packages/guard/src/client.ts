/** HTTP client for a Mastyf check service (the free service on this machine, or one you run). */
import { MastyfRefusedError, MastyfUnavailableError, parseVerdict, type Verdict } from './verdict.js';

const DEFAULT_SERVICE_LIMIT = 2 * 1024 * 1024; // what a check service accepts unless it says otherwise

export interface Where {
  server: string;
  session: string;
}

export class CheckClient {
  readonly url: string;

  constructor(
    url: string,
    private readonly token: string,
    private readonly timeoutMs = 10_000,
    private maxBodyBytes?: number,
  ) {
    // No regex: /\/+$/ backtracks quadratically on an address with many slashes.
    let end = url.length;
    while (end > 0 && url.charCodeAt(end - 1) === 47 /* "/" */) end--;
    this.url = url.slice(0, end);
  }

  /** Use the request size limit the service reported (from /v1/health). */
  limitBody(maxBodyBytes: unknown): void {
    if (typeof maxBodyBytes === 'number' && Number.isInteger(maxBodyBytes) && maxBodyBytes > 0) this.maxBodyBytes = maxBodyBytes;
  }

  checkCall(tool: string, args: Record<string, unknown>, where: Where): Promise<Verdict> {
    return this.verdict('/v1/check/call', { tool, arguments: args, server: where.server, session: where.session });
  }

  checkResult(tool: string, result: unknown, where: Where & { arguments?: Record<string, unknown> }): Promise<Verdict> {
    const body: Record<string, unknown> = { tool, result, server: where.server, session: where.session };
    if (where.arguments !== undefined) body['arguments'] = where.arguments;
    return this.verdict('/v1/check/result', body);
  }

  /** Tells the service what a server offers. Returns the verdict when the list is blocked or redacted. */
  async registerTools(server: string, tools: unknown[], opts: { session: string }): Promise<Verdict | null> {
    const v = await this.verdict('/v1/tools', { server, tools, session: opts.session });
    return v.decision === 'allow' ? null : v;
  }

  /**
   * The service's health (no token sent). With a nonce, a service that knows the token adds
   * "proof": the HMAC-SHA256 of the nonce keyed by the token.
   */
  async health(nonce?: string): Promise<Record<string, unknown> | null> {
    try {
      const q = nonce ? `?nonce=${encodeURIComponent(nonce)}` : '';
      const res = await fetch(`${this.url}/v1/health${q}`, { redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs) });
      if (res.status !== 200) return null;
      const data = await res.json();
      return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  private async verdict(path: string, body: Record<string, unknown>): Promise<Verdict> {
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    if (this.maxBodyBytes !== undefined && data.length > this.maxBodyBytes) {
      throw new MastyfRefusedError(`the input is larger than the check service accepts (${data.length} bytes)`);
    }
    let res: Response;
    try {
      res = await fetch(`${this.url}${path}`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
        body: data,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if (data.length > DEFAULT_SERVICE_LIMIT) {
        // A service that doesn't report its limit drops an oversize upload mid-way.
        throw new MastyfRefusedError(`the check service at ${this.url} didn't take an input of ${data.length} bytes`);
      }
      // The message never includes the request: it carries the token and the tool's data.
      throw new MastyfUnavailableError(`the check service at ${this.url} didn't answer (${(err as Error)?.name ?? 'error'})`);
    }
    if (res.status === 400 || res.status === 413) {
      await res.body?.cancel().catch(() => {});
      throw new MastyfRefusedError(`the check service at ${this.url} refused this input (${res.status})`);
    }
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      throw new MastyfUnavailableError(`the check service at ${this.url} answered ${res.status}`);
    }
    try {
      return parseVerdict(await res.json());
    } catch {
      throw new MastyfUnavailableError(`the check service at ${this.url} sent an answer that isn't a verdict`);
    }
  }
}
