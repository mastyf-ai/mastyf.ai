/**
 * Shield's protection switch (Shield 0.6 and later). Shield listens on 127.0.0.1 and writes its port
 * and a random key to an owner-only file (%APPDATA%\Mastyf\shield\control.json). The extension only
 * ever asks to turn protection on; turning it off stays in Shield, which asks the user first.
 * The key goes to 127.0.0.1 and nowhere else, and never appears in a result or a log line.
 */

export interface ControlFile {
  port: number;
  key: string;
}

export interface ProtectionStatus {
  protected: boolean;
  agents: number;
  unprotectedServers: number;
}

export type TurnOnResult = { ok: true; newlyProtected: number } | { ok: false; reason: 'unavailable' | 'busy' | 'failed' };

export function parseControlFile(text: string): ControlFile | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const { port, key } = v as Record<string, unknown>;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (typeof key !== 'string' || key.length < 32) return null;
  return { port, key };
}

export interface ProtectionControlOptions {
  /** The control file's text, or null when it isn't there. */
  readFile: () => string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class ProtectionControl {
  private readonly readFile: () => string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: ProtectionControlOptions) {
    this.readFile = opts.readFile;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  /** Whether Shield protects this PC's agents, or null when Shield's switch isn't reachable. */
  async status(): Promise<ProtectionStatus | null> {
    const r = await this.send('GET');
    if (!r || r.status !== 200 || !r.body || typeof r.body !== 'object') return null;
    const b = r.body as Record<string, unknown>;
    if (typeof b['protected'] !== 'boolean') return null;
    return { protected: b['protected'], agents: Number(b['agents']) || 0, unprotectedServers: Number(b['unprotectedServers']) || 0 };
  }

  /** Asks Shield to protect every installed agent, as Shield's own switch does. */
  async turnOn(): Promise<TurnOnResult> {
    const r = await this.send('POST', { protect: true });
    if (!r || r.status === 401 || r.status === 403) return { ok: false, reason: 'unavailable' };
    if (r.status === 409) return { ok: false, reason: 'busy' };
    if (r.status !== 200) return { ok: false, reason: 'failed' };
    return { ok: true, newlyProtected: Number((r.body as Record<string, unknown> | null)?.['newlyProtected']) || 0 };
  }

  private async send(method: 'GET' | 'POST', body?: unknown): Promise<{ status: number; body: unknown } | null> {
    let text: string | null;
    try {
      text = this.readFile();
    } catch {
      return null;
    }
    const file = text === null ? null : parseControlFile(text);
    if (!file) return null;
    const controller = new AbortController();
    // Long enough for Shield to rewrite the agents' settings files.
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`http://127.0.0.1:${file.port}/v1/protection`, {
        method,
        headers: { Authorization: `Bearer ${file.key}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
        redirect: 'error', // the key must never follow a redirect anywhere else
      });
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        /* not JSON */
      }
      return { status: res.status, body: parsed };
    } catch {
      return null; // the error may quote the request, which carries the key
    } finally {
      clearTimeout(timer);
    }
  }
}
