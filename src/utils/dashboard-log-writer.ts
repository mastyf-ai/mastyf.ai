import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

let counter = 0;
let logsDirCache = '';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';
export type LogCategory =
  | 'user_activity' | 'security' | 'deployment' | 'system' | 'error'
  | 'warning' | 'debug' | 'swarm' | 'api_request' | 'policy_decision' | 'auth' | 'plugin';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  source?: string;
  details?: string;
  metadata?: Record<string, unknown>;
}

function getLogsDir(tenantId: string): string {
  const base = process.env.MASTYF_AI_DATA_DIR || join(process.cwd(), 'data');
  const dir = join(base, 'tenants', tenantId, 'logs');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  logsDirCache = dir;
  return dir;
}

function logFilePath(tenantId: string): string {
  const dir = getLogsDir(tenantId);
  const date = new Date().toISOString().slice(0, 10);
  return join(dir, `logs-${date}.jsonl`);
}

function nextId(): string {
  counter += 1;
  return `log-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 6)}`;
}

export function writeLogEntry(
  tenantId: string,
  level: LogLevel,
  category: LogCategory,
  message: string,
  opts?: { source?: string; details?: string; metadata?: Record<string, unknown> },
): LogEntry {
  const entry: LogEntry = {
    id: nextId(),
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    source: opts?.source,
    details: opts?.details,
    metadata: opts?.metadata,
  };
  try {
    appendFileSync(logFilePath(tenantId), JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // best-effort logging
  }
  return entry;
}

export function writeLogEntries(tenantId: string, entries: LogEntry[]): void {
  if (entries.length === 0) return;
  try {
    const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
    appendFileSync(logFilePath(tenantId), content, 'utf-8');
  } catch {
    // best-effort logging
  }
}

export function loadLogEntries(tenantId: string, options: {
  search?: string;
  category?: string;
  level?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}): { entries: LogEntry[]; total: number } {
  const logsDir = getLogsDir(tenantId);
  let allEntries: LogEntry[] = [];

  try {
    const files = readdirSync(logsDir)
      .filter(f => f.endsWith('.jsonl') && f.startsWith('logs-'))
      .sort()
      .reverse();
    for (const file of files) {
      try {
        const content = readFileSync(join(logsDir, file), 'utf-8');
        const lines = content.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as LogEntry;
            allEntries.push(entry);
          } catch {
            // skip malformed
          }
        }
      } catch {
        // skip unreadable
      }
    }
  } catch {
    // dir may not exist
  }

  if (options.search) {
    const q = options.search.toLowerCase();
    allEntries = allEntries.filter(e =>
      (e.message || '').toLowerCase().includes(q) ||
      (e.details || '').toLowerCase().includes(q)
    );
  }
  if (options.category) {
    allEntries = allEntries.filter(e => e.category === options.category);
  }
  if (options.level) {
    allEntries = allEntries.filter(e => e.level === options.level);
  }
  if (options.startDate) {
    const start = new Date(options.startDate).getTime();
    allEntries = allEntries.filter(e => new Date(e.timestamp).getTime() >= start);
  }
  if (options.endDate) {
    const end = new Date(options.endDate).getTime();
    allEntries = allEntries.filter(e => new Date(e.timestamp).getTime() <= end);
  }

  allEntries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const total = allEntries.length;
  const offset = options.offset || 0;
  const limit = options.limit || 100;
  const entries = allEntries.slice(offset, offset + limit);

  return { entries, total };
}

export function getRecentLogEntries(tenantId: string, maxCount = 50): LogEntry[] {
  return loadLogEntries(tenantId, { limit: maxCount }).entries;
}

export function clearLogFiles(tenantId: string, category?: string): void {
  const logsDir = getLogsDir(tenantId);
  if (!existsSync(logsDir)) return;
  const files = readdirSync(logsDir).filter(f => f.endsWith('.jsonl'));
  for (const file of files) {
    const filePath = join(logsDir, file);
    if (category) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(Boolean);
        const filtered = lines.filter(line => {
          try {
            const entry = JSON.parse(line);
            return entry.category !== category;
          } catch {
            return true;
          }
        });
        if (filtered.length === 0) {
          unlinkSync(filePath);
        } else {
          writeFileSync(filePath, filtered.join('\n') + '\n', 'utf-8');
        }
      } catch {
        // skip
      }
    } else {
      try { unlinkSync(filePath); } catch { /* skip */ }
    }
  }
}

export interface RetentionConfig {
  retentionDays: number;
  maxStorageMb: number;
  enabledCategories: LogCategory[];
}

const DEFAULT_RETENTION: RetentionConfig = {
  retentionDays: 30,
  maxStorageMb: 100,
  enabledCategories: ['user_activity', 'security', 'deployment', 'system', 'error', 'warning', 'debug', 'swarm', 'api_request', 'policy_decision', 'auth', 'plugin'],
};

function getRetentionConfig(tenantId: string): RetentionConfig {
  const dir = getLogsDir(tenantId);
  const cfgPath = join(dir, '.retention.json');
  try {
    return JSON.parse(readFileSync(cfgPath, 'utf-8'));
  } catch {
    return DEFAULT_RETENTION;
  }
}

export function setRetentionConfig(tenantId: string, cfg: Partial<RetentionConfig>): RetentionConfig {
  const current = getRetentionConfig(tenantId);
  const merged = { ...current, ...cfg };
  const dir = getLogsDir(tenantId);
  writeFileSync(join(dir, '.retention.json'), JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

export function enforceRetention(tenantId: string): { deletedFiles: number } {
  const cfg = getRetentionConfig(tenantId);
  const logsDir = getLogsDir(tenantId);
  if (!existsSync(logsDir)) return { deletedFiles: 0 };

  const now = Date.now();
  const cutoffMs = cfg.retentionDays * 86400000;
  let deletedFiles = 0;

  const files = readdirSync(logsDir).filter(f => f.endsWith('.jsonl') && f.startsWith('logs-'));
  for (const file of files) {
    const dateStr = file.replace('logs-', '').replace('.jsonl', '');
    const fileDate = new Date(dateStr).getTime();
    if (!isNaN(fileDate) && (now - fileDate) > cutoffMs) {
      try {
        unlinkSync(join(logsDir, file));
        deletedFiles++;
      } catch { /* skip */ }
    }
  }

  if (cfg.maxStorageMb > 0) {
    let totalBytes = 0;
    const fileSizes = files.map(f => {
      const fp = join(logsDir, f);
      const size = existsSync(fp) ? statSync(fp).size : 0;
      totalBytes += size;
      return { name: f, path: fp, size };
    });
    const maxBytes = cfg.maxStorageMb * 1024 * 1024;
    if (totalBytes > maxBytes) {
      fileSizes.sort((a, b) => a.name.localeCompare(b.name));
      while (totalBytes > maxBytes && fileSizes.length > 1) {
        const oldest = fileSizes.shift();
        if (oldest) {
          try {
            unlinkSync(oldest.path);
            totalBytes -= oldest.size;
            deletedFiles++;
          } catch { /* skip */ }
        }
      }
    }
  }

  return { deletedFiles };
}

let retentionTimer: ReturnType<typeof setInterval> | null = null;

export function startRetentionScheduler(tenantId: string, intervalMs = 3600000): void {
  stopRetentionScheduler();
  enforceRetention(tenantId);
  retentionTimer = setInterval(() => { enforceRetention(tenantId); }, intervalMs);
}

export function stopRetentionScheduler(): void {
  if (retentionTimer) {
    clearInterval(retentionTimer);
    retentionTimer = null;
  }
}
