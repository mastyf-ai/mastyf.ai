/**
 * Poison written to an agent's memory outlives the session that wrote it. Values written to memory
 * from attacker-writable data stay marked, across sessions and restarts, within the tenant. Everything
 * else read back from memory is treated as the agent's own, so normal memory use is not penalized.
 */
import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { valueHash } from './ledger.js';
import { nameWords } from './origins.js';

export interface TaintStore {
  add(tenantId: string, norms: string[]): void;
  has(tenantId: string, norm: string): boolean;
}

const MEMORY_NOUN = new Set(['memories', 'memory', 'recall', 'remember']);
const WRITE_VERB = new Set(['add', 'append', 'create', 'put', 'remember', 'save', 'set', 'store', 'update', 'upsert', 'write']);
const READ_VERB = new Set(['fetch', 'find', 'get', 'list', 'load', 'query', 'read', 'recall', 'retrieve', 'search']);
const MAX_HASHES_PER_TENANT = 50_000;

export function memoryToolKind(tool: string): 'write' | 'read' | null {
  const words = nameWords(tool);
  if (!words.some((w) => MEMORY_NOUN.has(w))) return null;
  // get_memory_usage_stats reports on memory rather than reading it; a memory tool has few words.
  if (words.length > 3) return null;
  if (words.some((w) => WRITE_VERB.has(w))) return 'write';
  if (words.some((w) => READ_VERB.has(w))) return 'read';
  return null;
}

export class MemoryTaintStore implements TaintStore {
  private readonly tenants = new Map<string, Set<string>>();

  add(tenantId: string, norms: string[]): void {
    let set = this.tenants.get(tenantId);
    if (!set) {
      set = new Set();
      this.tenants.set(tenantId, set);
    }
    for (const norm of norms) set.add(valueHash(norm));
  }

  has(tenantId: string, norm: string): boolean {
    return this.tenants.get(tenantId)?.has(valueHash(norm)) ?? false;
  }
}

/**
 * Hashes on disk, never the values. Proxies running as separate processes share one file, so the read
 * side reloads when the file changes. A failed read or write loses taint rather than breaking calls.
 */
export class FileTaintStore implements TaintStore {
  private tenants = new Map<string, Set<string>>();
  private loadedAt = -1;

  constructor(private readonly path: string) {}

  private load(): void {
    let fd: number | undefined;
    try {
      // One handle, so that the time and the contents are of the same file.
      fd = openSync(this.path, 'r');
      const changed = fstatSync(fd).mtimeMs;
      if (changed === this.loadedAt) return;
      const parsed = JSON.parse(readFileSync(fd, 'utf8')) as Record<string, string[]>;
      this.tenants = new Map(Object.entries(parsed).map(([t, hashes]) => [t, new Set(hashes)]));
      this.loadedAt = changed;
    } catch {
      // no file yet, or unreadable: keep what is in memory
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  add(tenantId: string, norms: string[]): void {
    this.load();
    let set = this.tenants.get(tenantId);
    if (!set) {
      set = new Set();
      this.tenants.set(tenantId, set);
    }
    for (const norm of norms) set.add(valueHash(norm));
    for (const oldest of set) {
      if (set.size <= MAX_HASHES_PER_TENANT) break;
      set.delete(oldest);
    }
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      const tmp = `${this.path}.${process.pid}.tmp`;
      const body = Object.fromEntries([...this.tenants].map(([t, hashes]) => [t, [...hashes]]));
      writeFileSync(tmp, JSON.stringify(body), { mode: 0o600 });
      renameSync(tmp, this.path);
      // Another proxy may have written since the rename, so the time on the file now may not be ours.
      this.loadedAt = -1;
    } catch {
      // keep going with what is in memory
    }
  }

  has(tenantId: string, norm: string): boolean {
    this.load();
    return this.tenants.get(tenantId)?.has(valueHash(norm)) ?? false;
  }
}
