/**
 * Rug-pull event persistence — stores detected tool-definition drift events
 * for dashboard surfacing and audit compliance.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';

function stateDir(): string {
  return join(homedir(), '.mastyf-ai');
}

function statePath(): string {
  const dir = stateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'rug-pull-events.jsonl');
}

export interface RugPullEvent {
  id: string;
  serverName: string;
  tenantId: string;
  previousFingerprint: string;
  currentFingerprint: string;
  toolCount: number;
  detectedAt: string;
}

export function persistRugPullEvent(event: Omit<RugPullEvent, 'id' | 'detectedAt'>): RugPullEvent {
  const record: RugPullEvent = {
    ...event,
    id: randomUUID(),
    detectedAt: new Date().toISOString(),
  };
  try {
    appendFileSync(statePath(), JSON.stringify(record) + '\n', 'utf-8');
  } catch (err) {
    // Non-fatal — the event is still counted in Prometheus and structured logs
  }
  return record;
}

export function listRugPullEvents(opts?: {
  tenantId?: string;
  serverName?: string;
  windowHours?: number;
  limit?: number;
}): RugPullEvent[] {
  const path = statePath();
  if (!existsSync(path)) return [];

  const since = opts?.windowHours
    ? Date.now() - opts.windowHours * 3600_000
    : 0;

  try {
    const lines = readFileSync(path, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try { return JSON.parse(l) as RugPullEvent; } catch { return null; }
      })
      .filter((e): e is RugPullEvent => e !== null)
      .filter((e) => {
        if (opts?.tenantId && e.tenantId !== opts.tenantId) return false;
        if (opts?.serverName && e.serverName !== opts.serverName) return false;
        if (since > 0 && new Date(e.detectedAt).getTime() < since) return false;
        return true;
      })
      .sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime());
    return opts?.limit ? lines.slice(0, opts.limit) : lines;
  } catch {
    return [];
  }
}

export function countRugPullEvents(opts?: {
  tenantId?: string;
  windowHours?: number;
}): number {
  return listRugPullEvents(opts).length;
}

export function clearRugPullEvents(): void {
  try { writeFileSync(statePath(), '', 'utf-8'); } catch { /* noop */ }
}
