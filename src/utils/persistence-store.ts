import type Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { encryptField, decryptField, isFieldEncryptionEnabled } from './field-encryption.js';

interface HistoryDb {
  exec(sql: string): void;
  prepare(sql: string): any;
}

interface SsoConfigRow {
  id: string;
  tenant_id: string;
  provider_type: string;
  name: string;
  issuer_url: string;
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  scopes: string;
  claim_mappings: string;
  role_map: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface CredentialRow {
  id: string;
  tenant_id: string;
  user_id: string;
  provider_name: string;
  provider_id: string;
  credential_type: string;
  encrypted_token: string;
  encrypted_refresh_token: string | null;
  scopes: string;
  expires_at: string | null;
  created_at: string;
  metadata: string;
}

interface UserPolicyRow {
  id: string;
  tenant_id: string;
  user_id: string;
  username: string;
  roles: string;
  allowed_tools: string;
  denied_tools: string;
  rate_limit_per_minute: number;
  max_tokens_per_call: number;
  allowed_paths: string;
  denied_paths: string;
}

interface FeedRow {
  id: string;
  tenant_id: string;
  name: string;
  feed_url: string;
  enabled: number;
  last_sync: string | null;
  added_count: number;
  created_at: string;
}

let _store: PersistenceStore | null = null;

export function getPersistenceStore(): PersistenceStore {
  if (!_store) _store = new PersistenceStore(null as any);
  return _store;
}

export function setPersistenceStore(store: PersistenceStore): void {
  _store = store;
}

export class PersistenceStore {
  private db: HistoryDb | null = null;
  private initialized = false;

  constructor(db: HistoryDb | null) {
    this.db = db;
  }

  attach(db: HistoryDb): void {
    this.db = db;
  }

  private enc(s: string): string { return isFieldEncryptionEnabled() ? (encryptField(s) ?? s) : s; }
  private dec(s: string): string { return isFieldEncryptionEnabled() ? (decryptField(s) ?? s) : s; }

  initTables(): void {
    if (!this.db || this.initialized) return;
    this.initialized = true;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_idp_configs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        name TEXT NOT NULL,
        issuer_url TEXT NOT NULL,
        client_id TEXT NOT NULL,
        client_secret TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        scopes TEXT DEFAULT '[]',
        claim_mappings TEXT DEFAULT '{}',
        role_map TEXT DEFAULT '{}',
        enabled INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_credentials (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        provider_name TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        credential_type TEXT NOT NULL,
        encrypted_token TEXT NOT NULL,
        encrypted_refresh_token TEXT,
        scopes TEXT DEFAULT '[]',
        expires_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        metadata TEXT DEFAULT '{}'
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_tool_policies (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL DEFAULT '',
        roles TEXT DEFAULT '[]',
        allowed_tools TEXT DEFAULT '[]',
        denied_tools TEXT DEFAULT '[]',
        rate_limit_per_minute INTEGER DEFAULT 60,
        max_tokens_per_call INTEGER DEFAULT 5000,
        allowed_paths TEXT DEFAULT '[]',
        denied_paths TEXT DEFAULT '[]'
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threat_feed_subscriptions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        feed_url TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        last_sync TEXT,
        added_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_idp_configs_tenant ON auth_idp_configs(tenant_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_credentials_lookup ON auth_credentials(tenant_id, provider_id, credential_type)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_user_policies_tenant ON user_tool_policies(tenant_id, user_id)`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS corpus_rule_stats (
        rule_name TEXT PRIMARY KEY,
        false_positives INTEGER DEFAULT 0,
        true_positives INTEGER DEFAULT 0,
        last_updated TEXT DEFAULT (datetime('now'))
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_hash_chain (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prev_hash TEXT NOT NULL,
        entry_hash TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_data TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_chain_prev ON audit_hash_chain(prev_hash)`);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS custom_hooks (
        name TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('before', 'after', 'error')),
        priority INTEGER DEFAULT 50,
        enabled INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS corpus_entries (
        id TEXT PRIMARY KEY,
        tool TEXT NOT NULL,
        args TEXT NOT NULL,
        expected_action TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        source TEXT DEFAULT 'blocked-call',
        block_rule TEXT,
        verified INTEGER DEFAULT 0,
        verified_by TEXT,
        verified_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
  }

  private ensure<T>(fn: () => T, fallback: T): T {
    if (!this.db) return fallback;
    try { return fn(); } catch { return fallback; }
  }

  // ── SSO Configs ──────────────────────────────────────────────────────────

  getSsoConfigs(tenantId: string): SsoConfigRow[] {
    return this.ensure(() => {
      const stmt = this.db!.prepare('SELECT * FROM auth_idp_configs WHERE tenant_id = ? ORDER BY name');
      const rows = stmt.all(tenantId) as SsoConfigRow[];
      if (!isFieldEncryptionEnabled()) return rows;
      return rows.map(r => {
        try { return { ...r, client_secret: decryptField(r.client_secret) ?? r.client_secret }; }
        catch { return r; }
      });
    }, []);
  }

  getSsoConfig(tenantId: string, id: string): SsoConfigRow | null {
    return this.ensure(() => {
      const stmt = this.db!.prepare('SELECT * FROM auth_idp_configs WHERE tenant_id = ? AND id = ?');
      const rows = stmt.all(tenantId, id) as SsoConfigRow[];
      if (rows.length === 0) return null;
      const row = rows[0];
      return { ...row, client_secret: this.dec(row.client_secret) };
    }, null);
  }

  saveSsoConfig(row: SsoConfigRow): void {
    this.ensure(() => {
      const existing = this.getSsoConfig(row.tenant_id, row.id);
      if (existing) {
        const stmt = this.db!.prepare(
          `UPDATE auth_idp_configs SET name=?, issuer_url=?, client_id=?, client_secret=?,
           redirect_uri=?, scopes=?, claim_mappings=?, role_map=?, enabled=?, updated_at=datetime('now')
           WHERE tenant_id=? AND id=?`
        );
        stmt.run(row.name, row.issuer_url, row.client_id, row.client_secret,
          row.redirect_uri, row.scopes, row.claim_mappings, row.role_map, row.enabled,
          row.tenant_id, row.id);
      } else {
      const stmt = this.db!.prepare(
        `INSERT INTO auth_idp_configs (id, tenant_id, provider_type, name, issuer_url,
         client_id, client_secret, redirect_uri, scopes, claim_mappings, role_map, enabled, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`
      );
      stmt.run(row.id, row.tenant_id, row.provider_type, row.name, row.issuer_url,
        row.client_id, this.enc(row.client_secret), row.redirect_uri, row.scopes, row.claim_mappings,
        row.role_map, row.enabled);
      }
    }, undefined);
  }

  deleteSsoConfig(tenantId: string, id: string): boolean {
    return this.ensure(() => {
      const stmt = this.db!.prepare('DELETE FROM auth_idp_configs WHERE tenant_id = ? AND id = ?');
      const result = stmt.run(tenantId, id);
      return result.changes > 0;
    }, false);
  }

  // ── Credentials ──────────────────────────────────────────────────────────

  getCredentials(tenantId: string, providerId: string, credentialType: string): CredentialRow | null {
    return this.ensure(() => {
      const stmt = this.db!.prepare(
        'SELECT * FROM auth_credentials WHERE tenant_id=? AND provider_id=? AND credential_type=? ORDER BY created_at DESC LIMIT 1'
      );
      const rows = stmt.all(tenantId, providerId, credentialType) as CredentialRow[];
      return rows[0] || null;
    }, null);
  }

  saveCredential(row: CredentialRow): void {
    this.ensure(() => {
      const stmt = this.db!.prepare(
        `INSERT INTO auth_credentials (id, tenant_id, user_id, provider_name, provider_id,
         credential_type, encrypted_token, encrypted_refresh_token, scopes, expires_at, metadata, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`
      );
      stmt.run(row.id, row.tenant_id, row.user_id, row.provider_name, row.provider_id,
        row.credential_type, row.encrypted_token, row.encrypted_refresh_token,
        row.scopes, row.expires_at, row.metadata);
    }, undefined);
  }

  deleteCredentialsForUser(userId: string): boolean {
    return this.ensure(() => {
      const stmt = this.db!.prepare('DELETE FROM auth_credentials WHERE user_id = ?');
      return stmt.run(userId).changes > 0;
    }, false);
  }

  // ── User Tool Policies ───────────────────────────────────────────────────

  getUserPolicies(tenantId: string): UserPolicyRow[] {
    return this.ensure(() => {
      const stmt = this.db!.prepare('SELECT * FROM user_tool_policies WHERE tenant_id = ?');
      return stmt.all(tenantId) as UserPolicyRow[];
    }, []);
  }

  saveUserPolicy(row: UserPolicyRow): void {
    this.ensure(() => {
      const stmt = this.db!.prepare(
        `INSERT OR REPLACE INTO user_tool_policies (id, tenant_id, user_id, username, roles,
         allowed_tools, denied_tools, rate_limit_per_minute, max_tokens_per_call, allowed_paths, denied_paths)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      );
      stmt.run(row.id, row.tenant_id, row.user_id, row.username, row.roles,
        row.allowed_tools, row.denied_tools, row.rate_limit_per_minute,
        row.max_tokens_per_call, row.allowed_paths, row.denied_paths);
    }, undefined);
  }

  deleteUserPolicy(tenantId: string, policyId: string): boolean {
    return this.ensure(() => {
      const stmt = this.db!.prepare('DELETE FROM user_tool_policies WHERE tenant_id = ? AND id = ?');
      return stmt.run(tenantId, policyId).changes > 0;
    }, false);
  }

  // ── Threat Feed Subscriptions ────────────────────────────────────────────

  getFeedSubscriptions(tenantId: string): FeedRow[] {
    return this.ensure(() => {
      const stmt = this.db!.prepare('SELECT * FROM threat_feed_subscriptions WHERE tenant_id = ?');
      return stmt.all(tenantId) as FeedRow[];
    }, []);
  }

  saveFeedSubscription(row: FeedRow): void {
    this.ensure(() => {
      const stmt = this.db!.prepare(
        `INSERT OR REPLACE INTO threat_feed_subscriptions (id, tenant_id, name, feed_url, enabled, last_sync, added_count, created_at)
         VALUES (?,?,?,?,?,?,?,?)`
      );
      stmt.run(row.id, row.tenant_id, row.name, row.feed_url, row.enabled,
        row.last_sync, row.added_count, row.created_at || new Date().toISOString());
    }, undefined);
  }

  // ── Custom Hooks ─────────────────────────────────────────────────────────

  getCustomHooks(): Array<{ name: string; code: string; type: string; priority: number; enabled: number }> {
    return this.ensure(() => {
      const stmt = this.db!.prepare('SELECT * FROM custom_hooks WHERE enabled = 1 ORDER BY priority');
      return stmt.all() as any[];
    }, []);
  }

  saveCustomHook(name: string, code: string, type: string, priority: number): void {
    this.ensure(() => {
      const stmt = this.db!.prepare(
        'INSERT OR REPLACE INTO custom_hooks (name, code, type, priority, enabled) VALUES (?,?,?,?,1)'
      );
      stmt.run(name, code, type, priority);
    }, undefined);
  }

  deleteCustomHook(name: string): void {
    this.ensure(() => {
      this.db!.prepare('DELETE FROM custom_hooks WHERE name = ?').run(name);
    }, undefined);
  }

  // ── Corpus Entries (growing eval payloads) ───────────────────────────────

  getCorpusEntries(verifiedOnly = true): Array<{ id: string; tool: string; args: string; expected_action: string; category: string; description: string; block_rule: string | null; verified: number; created_at: string }> {
    return this.ensure(() => {
      const sql = verifiedOnly
        ? 'SELECT * FROM corpus_entries WHERE verified = 1 ORDER BY created_at'
        : 'SELECT * FROM corpus_entries ORDER BY created_at DESC';
      return this.db!.prepare(sql).all() as any[];
    }, []);
  }

  verifyCorpusEntry(id: string): void {
    this.ensure(() => {
      this.db!.prepare('UPDATE corpus_entries SET verified = 1, verified_at = datetime(\'now\') WHERE id = ?').run(id);
    }, undefined);
  }

  rejectCorpusEntry(id: string): void {
    this.ensure(() => {
      const entry = this.db!.prepare('SELECT block_rule FROM corpus_entries WHERE id = ? AND verified = 0').get(id) as any;
      if (entry?.block_rule) {
        this.db!.prepare(
          'INSERT INTO corpus_rule_stats (rule_name, false_positives) VALUES (?, 1) ON CONFLICT(rule_name) DO UPDATE SET false_positives = false_positives + 1, last_updated = datetime(\'now\')'
        ).run(entry.block_rule);
      }
      this.db!.prepare('DELETE FROM corpus_entries WHERE id = ? AND verified = 0').run(id);
    }, undefined);
  }

  getCorpusRuleStats(): Array<{ rule_name: string; false_positives: number; true_positives: number; last_updated: string }> {
    return this.ensure(() => {
      return this.db!.prepare('SELECT * FROM corpus_rule_stats ORDER BY false_positives DESC').all() as any[];
    }, []);
  }

  getHighFalsePositiveRules(threshold = 3): string[] {
    return this.ensure(() => {
      const rows = this.db!.prepare('SELECT rule_name FROM corpus_rule_stats WHERE false_positives >= ?').all(threshold) as any[];
      return rows.map((r: any) => r.rule_name);
    }, []);
  }

  verifyAuditChain() {
    const entries: any[] = this.ensure(() => {
      return this.db!.prepare('SELECT * FROM audit_hash_chain ORDER BY id').all();
    }, []);
    let breaks = 0;
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].prev_hash !== entries[i - 1].entry_hash) breaks++;
    }
    return { ok: breaks === 0, breaks, entries: entries.length };
  }

  getUnverifiedCount(): number {
    return this.ensure(() => {
      const row = this.db!.prepare('SELECT count(*) as c FROM corpus_entries WHERE verified = 0').get() as any;
      return row?.c || 0;
    }, 0);
  }

  addCorpusEntry(entry: { tool: string; args: string; expectedAction: string; category: string; description: string; blockRule?: string }): string {
    const id = `corpus_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.ensure(() => {
      const stmt = this.db!.prepare(
        'INSERT OR REPLACE INTO corpus_entries (id, tool, args, expected_action, category, description, block_rule) VALUES (?,?,?,?,?,?,?)'
      );
      stmt.run(id, entry.tool, entry.args, entry.expectedAction, entry.category, entry.description, entry.blockRule || null);
    }, undefined);
    return id;
  }

  appendAuditEntry(eventType: string, eventData: Record<string, unknown>): string {
    const prevRow: any = this.ensure(() => {
      const row = this.db!.prepare('SELECT entry_hash FROM audit_hash_chain ORDER BY id DESC LIMIT 1').get();
      return row?.entry_hash || '0'.repeat(64);
    }, '0'.repeat(64));
    const dataStr = JSON.stringify({ eventType, eventData, prev: prevRow, ts: new Date().toISOString() });
    const entryHash = createHash('sha256').update(dataStr).digest('hex');
    this.ensure(() => {
      this.db!.prepare('INSERT INTO audit_hash_chain (prev_hash, entry_hash, event_type, event_data) VALUES (?,?,?,?)')
        .run(prevRow, entryHash, eventType, JSON.stringify(eventData));
    }, undefined);
    return entryHash;
  }
}
