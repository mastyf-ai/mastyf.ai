/**
 * Sends a record of each checked tool call to the user's workspace on mastyf.ai, where the free
 * Activity page (and the Shield app, for paid workspaces) shows it.
 *
 * What leaves the machine: server, tool, decision, rule, timing, a fingerprint and a short snippet
 * redacted here first (secret-named keys and secret-looking values removed). Never the raw arguments.
 * It never blocks or slows a call: events are queued and sent in batches, and dropped if they can't be.
 * Turn it off with MASTYF_AI_ACTIVITY_UPLOAD=false.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redactArgSnippets } from '../ai/block-learning.js';
import { redactSecretsInText, snapshotAuditArguments } from '../utils/audit-args-snapshot.js';
import type { ProxyCallRecord } from '../types.js';

export interface ActivityEvent {
  id: string;
  occurredAt: string;
  agent: string | null;
  server: string;
  tool: string;
  direction: 'call' | 'result' | 'action';
  verdict: 'allow' | 'block' | 'flag' | 'held';
  rule: string | null;
  reason: string | null;
  latencyMs: number | null;
  fingerprint: string | null;
  snippet: string | null;
}

export interface ActivitySink {
  key: string;
  instanceId: string;
  baseUrl: string;
  device: string | undefined;
}

const DEFAULT_SITE = 'https://www.mastyf.ai';
const SNIPPET_MAX = 300;
const REASON_MAX = 300;

/** Where to send, or null to send nothing. Shield's launcher sets the key; `connect` saves it. */
export function resolveActivitySink(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): ActivitySink | null {
  if (env.MASTYF_AI_ACTIVITY_UPLOAD === 'false') return null;
  let key = env.MASTYF_AI_ACTIVITY_KEY?.trim();
  let instanceId = env.MASTYF_AI_INSTANCE_ID?.trim();
  if (!key) {
    try {
      const state = JSON.parse(fs.readFileSync(path.join(home, '.mastyf-ai', 'connect.json'), 'utf8')) as {
        key?: string;
        instanceId?: string;
      };
      key = state.key?.trim();
      instanceId = instanceId || state.instanceId;
    } catch {
      return null;
    }
  }
  if (!key) return null;
  const baseUrl = (env.MASTYF_AI_ACTIVITY_URL || env.MASTYF_SHIELD_SITE_URL || env.MASTYF_AI_CONTROL_PLANE_URL || DEFAULT_SITE)
    .trim()
    .replace(/\/+$/, '');
  return {
    key,
    // Stable per machine and key, so the site can tell machines apart without being told the hostname.
    instanceId: instanceId || `i-${createHash('sha256').update(`${os.hostname()}\0${key}`).digest('hex').slice(0, 24)}`,
    baseUrl,
    device: env.MASTYF_AI_DEVICE_NAME?.trim() || undefined,
  };
}

function cut(text: string | undefined | null, max: number): string | null {
  const t = text?.trim();
  return t ? t.slice(0, max) : null;
}

/**
 * Groups identical calls without revealing them: an HMAC under the workspace key, which the stored
 * records never contain. A plain hash of a short argument (a PIN, say) could be guessed back.
 */
function keyedFingerprint(args: unknown, key: string): string {
  let text: string;
  try {
    text = JSON.stringify(args, (_k, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
        : v,
    );
  } catch {
    text = String(args);
  }
  return createHmac('sha256', key).update(text).digest('hex').slice(0, 16);
}

/**
 * One call as the site stores it. `msg` is the request, used for the snippet when the record has none;
 * `fingerprintKey` is the workspace key (no key, no fingerprint).
 */
export function eventFromCallRecord(
  record: ProxyCallRecord,
  msg: unknown,
  agent: string | undefined,
  fingerprintKey?: string,
): ActivityEvent {
  const args = (msg as { params?: { arguments?: unknown } } | undefined)?.params?.arguments;
  const fromArgs =
    args && typeof args === 'object'
      ? redactArgSnippets(snapshotAuditArguments(args as Record<string, unknown>)).join(' | ')
      : '';
  const rawSnippet = record.argumentSnippet || fromArgs;
  const at = Date.parse(record.timestamp);
  return {
    id: randomUUID(),
    occurredAt: Number.isFinite(at) ? new Date(at).toISOString() : new Date().toISOString(),
    agent: cut(agent, 64),
    server: record.serverName,
    tool: record.toolName,
    direction: 'call',
    verdict: record.blocked ? 'block' : 'allow',
    rule: cut(record.blockRule, 128),
    reason: record.blockReason ? cut(redactSecretsInText(record.blockReason), REASON_MAX) : null,
    latencyMs: Number.isFinite(record.durationMs) ? Math.round(record.durationMs) : null,
    fingerprint: args && fingerprintKey ? keyedFingerprint(args, fingerprintKey) : null,
    snippet: rawSnippet ? cut(redactSecretsInText(rawSnippet), SNIPPET_MAX) : null,
  };
}

export class ActivityUploader {
  private queue: ActivityEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private sending = false;
  private refused = false;
  private readonly fetchImpl: typeof fetch;
  private readonly maxBatch: number;
  private readonly maxQueue: number;

  constructor(
    private readonly sink: ActivitySink,
    opts: { fetchImpl?: typeof fetch; flushMs?: number; maxBatch?: number; maxQueue?: number } = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxBatch = opts.maxBatch ?? 50;
    this.maxQueue = opts.maxQueue ?? 500;
    this.timer = setInterval(() => void this.flush(), opts.flushMs ?? 5_000);
    this.timer.unref?.();
  }

  enqueue(event: ActivityEvent): void {
    if (this.refused) return;
    this.queue.push(event);
    // Offline for a long time: keep the newest.
    if (this.queue.length > this.maxQueue) this.queue.splice(0, this.queue.length - this.maxQueue);
    if (this.queue.length >= this.maxBatch) void this.flush();
  }

  fingerprintKey(): string {
    return this.sink.key;
  }

  pending(): number {
    return this.queue.length;
  }

  async flush(): Promise<void> {
    if (this.sending || this.refused || this.queue.length === 0) return;
    this.sending = true;
    const batch = this.queue.slice(0, this.maxBatch);
    try {
      const res = await this.fetchImpl(`${this.sink.baseUrl}/api/v1/events`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.sink.key}`,
          'content-type': 'application/json',
          ...(this.sink.device ? { 'x-mastyf-device': this.sink.device } : {}),
        },
        body: JSON.stringify({ instanceId: this.sink.instanceId, events: batch }),
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok || res.status === 400) {
        // Stored, or refused as malformed: either way don't send these again.
        this.queue.splice(0, batch.length);
      } else if (res.status === 401 || res.status === 403) {
        // The key isn't accepted; stop rather than retry forever.
        this.refused = true;
        this.queue = [];
      }
    } catch {
      // Offline or slow: keep them for the next try.
    } finally {
      this.sending = false;
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

let shared: ActivityUploader | null | undefined;

/** The process-wide sender, or null when there is nowhere to send. */
export function activityUploader(): ActivityUploader | null {
  if (shared !== undefined) return shared;
  const sink = resolveActivitySink();
  shared = sink ? new ActivityUploader(sink) : null;
  if (shared) {
    const up = shared;
    process.once('beforeExit', () => void up.flush());
  }
  return shared;
}

/** Queue one checked call. Never throws: activity must not affect the call itself. */
export function recordActivity(record: ProxyCallRecord, msg?: unknown): void {
  try {
    const up = activityUploader();
    up?.enqueue(eventFromCallRecord(record, msg, process.env.MASTYF_AI_AGENT, up.fingerprintKey()));
  } catch {
    // ignore
  }
}

export function resetActivityUploaderForTests(): void {
  shared?.stop();
  shared = undefined;
}
