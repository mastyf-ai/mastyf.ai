import type { IncomingMessage, ServerResponse } from 'http';
import { globalHookRegistry } from '../proxy/tool-call-defense-orchestrator.js';
import { createCustomHook } from '../policy/tool-call-hooks.js';
import { CORPUS_EVAL_PAYLOADS, runPolicyEval, computeEvalStats } from '../policy/eval-playground.js';
import { getUserToolEnforcementEngine } from '../policy/strategies/user-tool-enforcement-strategy.js';
import { getPersistenceStore } from './persistence-store.js';
import { learningMode } from '../policy/learning-mode.js';
import type { UserToolPolicy } from '../policy/user-tool-enforcement.js';

async function triggerTribunalForUnverified(): Promise<{ ok: boolean; analyzed: number; verdicts: Record<string, string> }> {
  const store = getPersistenceStore();
  const unverified = store.getCorpusEntries(false).filter(e => !e.verified);
  if (unverified.length === 0) return { ok: true, analyzed: 0, verdicts: {} };

  const verdicts: Record<string, string> = {};
  let analyzed = 0;

  for (const entry of unverified.slice(0, 10)) {
    const entryData = { tool: entry.tool, args: entry.args, rule: entry.block_rule || 'unknown', description: entry.description };
    const verdict = analyzeEntryConfidence(entryData);
    verdicts[entry.id] = verdict;
    analyzed++;

    if (verdict === 'verify') {
      store.verifyCorpusEntry(entry.id);
    } else if (verdict === 'reject') {
      store.rejectCorpusEntry(entry.id);
    }
  }

  return { ok: true, analyzed, verdicts };
}

function analyzeEntryConfidence(entry: { tool: string; args: string; rule: string; description: string }): string {
  try {
    const args = JSON.parse(entry.args) as Record<string, unknown>;
    const argsStr = JSON.stringify(args);

    if (entry.rule === 'builtin-sensitive-path-guard') {
      if (argsStr.includes('/etc/') || argsStr.includes('/root/') || argsStr.includes('/var/')
        || argsStr.includes('.env') || argsStr.includes('.aws') || argsStr.includes('.ssh')
        || argsStr.includes('.npmrc') || argsStr.includes('.git/config')) {
        return 'verify';
      }
      return 'needs_review';
    }

    if (entry.rule === 'builtin-rate-limit') return 'needs_review';
    if (entry.rule === 'default') return 'needs_review';

    if (entry.rule.includes('deny-dangerous-tools')) return 'verify';
    if (entry.rule.includes('semantic')) return 'verify';
    if (entry.rule.includes('injection')) return 'verify';
    if (entry.rule.includes('encoding')) return 'verify';
    if (entry.rule.includes('ssrf') || entry.rule.includes('url')) return 'verify';

    return 'needs_review';
  } catch {
    return 'needs_review';
  }
}

type TrustGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

function computeGrade(score: number): TrustGrade {
  if (score >= 90) return 'A+'; if (score >= 80) return 'A'; if (score >= 60) return 'B';
  if (score >= 40) return 'C'; if (score >= 20) return 'D'; return 'F';
}

function registryScanResult(params: {
  packageName: string; cveCount?: number; criticalCveCount?: number;
  authStrength?: string; transportSecurity?: string;
}): Record<string, unknown> {
  const cvePosture = Math.max(0, 100 - ((params.cveCount || 0) * 10) - ((params.criticalCveCount || 0) * 25));
  const authScore = { none: 0, api_key: 30, oauth2: 70, oauth2_mtls: 100 }[params.authStrength || 'none'] ?? 0;
  const transportScore = { stdio: 10, http: 30, https: 60, mTLS: 100 }[params.transportSecurity || 'https'] ?? 60;
  const score = Math.round((cvePosture + authScore + transportScore + 60 + 70 + 80 + 60 + 80) / 8);
  return { packageName: params.packageName, trustScore: score, trustGrade: computeGrade(score), cveCount: params.cveCount || 0, criticalCveCount: params.criticalCveCount || 0, dimensions: { cvePosture: Math.round(cvePosture), authStrength: authScore, transportSecurity: transportScore, toolRiskSurface: 60, supplyChain: 70, attackHistory: 80, responseHygiene: 60, freshness: 80 }, scannedAt: new Date().toISOString() };
}

function registryBadgeSvg(score: number, grade: string): string {
  const colors: Record<string, string> = { 'A+': '#22c55e', 'A': '#22c55e', 'B': '#3b82f6', 'C': '#f59e0b', 'D': '#f97316', 'F': '#ef4444' };
  const color = colors[grade] || '#6b7280';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="20"><rect width="80" height="20" fill="#1f2937" rx="3"/><text x="40" y="14" fill="#f9fafb" font-size="11" font-family="monospace" text-anchor="middle" font-weight="bold">Mastyf ${grade}</text><rect x="80" width="60" height="20" fill="${color}" rx="3"/><text x="110" y="14" fill="#fff" font-size="11" font-family="monospace" text-anchor="middle">${score}/100</text></svg>`;
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
  });
}

type SetCorsFn = () => void;

export async function handleNewApiRoutes(
  url: string,
  method: string | undefined,
  req: IncomingMessage,
  res: ServerResponse,
  setCors: SetCorsFn,
    deps: {
      policyEngine?: { evaluateAsync: (ctx: unknown) => Promise<{ action: string; rule: string; reason: string }> };
      tenantId?: string;
      db?: any;
    },
): Promise<boolean> {
  // ── /api/registry/* ─────────────────────────────────────────────────────
  if (url === '/api/registry/scan' && method === 'POST') {
    setCors();
    const body = await parseBody(req);
    const packageName = (body.packageName as string) || '';
    if (!packageName) {
      writeJson(res, 400, { error: 'packageName is required' });
      return true;
    }
    const result = registryScanResult({
      packageName,
      cveCount: (body.cveCount as number) || 0,
      criticalCveCount: (body.criticalCveCount as number) || 0,
      authStrength: (body.authStrength as any) || 'none',
      transportSecurity: (body.transportSecurity as any) || 'https',
    });
    writeJson(res, 200, { result });
    return true;
  }

  if (url === '/api/registry/badge.svg' && method === 'GET') {
    setCors();
    const score = parseInt((new URL(req.url!, 'http://localhost')).searchParams.get('score') || '0', 10);
    const grade = (new URL(req.url!, 'http://localhost')).searchParams.get('grade') || 'F';
    const svg = registryBadgeSvg(score, grade);
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
    res.end(svg);
    return true;
  }

  // ── /api/eval/* ─────────────────────────────────────────────────────────
  if (url === '/api/eval/payloads' && method === 'GET') {
    setCors();
    const store = getPersistenceStore();
    const dbEntries = store.getCorpusEntries(true);
    const unverified = store.getUnverifiedCount();
    const dynamicPayloads = dbEntries.map(r => {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(r.args); } catch {}
      return {
        tool: r.tool, args, expectedAction: r.expected_action as any,
        category: r.category, description: r.description, id: r.id, verified: r.verified,
      };
    });
    const allPayloads = [...CORPUS_EVAL_PAYLOADS, ...dynamicPayloads];
    writeJson(res, 200, { payloads: allPayloads, total: allPayloads.length, static: CORPUS_EVAL_PAYLOADS.length, dynamic: dynamicPayloads.length, unverified });
    return true;
  }

  if (url === '/health' && method === 'GET') {
    setCors();
    const store = getPersistenceStore();
    const chainResult = store.verifyAuditChain ? store.verifyAuditChain() : { entries: 0 };
    writeJson(res, 200, { status: 'ready', uptime: process.uptime(), pid: process.pid, auditEntries: (chainResult as any).entries || 0, blockRate: 0 });
    return true;
  }

  if (url === '/api/health/detailed' && method === 'GET') {
    setCors();
    const store = getPersistenceStore();
    const chainResult = store.verifyAuditChain ? store.verifyAuditChain() : { entries: 0, ok: true, breaks: 0 };
    const policies = store.getUserPolicies(deps.tenantId || 'default');
    writeJson(res, 200, {
      status: 'ready',
      uptime: process.uptime(),
      pid: process.pid,
      audit: chainResult,
      policies: policies.length,
      memory: process.memoryUsage(),
      version: process.env.npm_package_version || '4.1.7',
    });
    return true;
  }

  if (url === '/api/eval/unverified' && method === 'GET') {
    setCors();
    const store = getPersistenceStore();
    const entries = store.getCorpusEntries(false).filter(e => !e.verified);
    writeJson(res, 200, { entries: entries.map(r => {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(r.args); } catch {}
      return { id: r.id, tool: r.tool, args, category: r.category, description: r.description, blockRule: r.block_rule, createdAt: r.created_at };
    }), total: entries.length });
    return true;
  }

  if (url === '/api/eval/verify' && method === 'POST') {
    setCors();
    const body = await parseBody(req);
    const store = getPersistenceStore();
    if (body.id) {
      store.verifyCorpusEntry(body.id as string);
      writeJson(res, 200, { ok: true, unverified: store.getUnverifiedCount() });
    } else if (body.reject) {
      store.rejectCorpusEntry(body.reject as string);
      writeJson(res, 200, { ok: true, unverified: store.getUnverifiedCount() });
    } else if (body.tribunal) {
      const result = await triggerTribunalForUnverified();
      writeJson(res, 200, result);
    } else {
      writeJson(res, 400, { error: 'id, reject, or tribunal required' });
    }
    return true;
  }

  if (url === '/api/eval/run' && method === 'POST') {
    setCors();
    const body = await parseBody(req);
    const payloads = (body.payloads as Array<{
      tool: string; server?: string; args: Record<string, unknown>;
      expectedAction: 'block' | 'pass' | 'flag';
      category: string; description: string;
    }>) || CORPUS_EVAL_PAYLOADS;

    if (!deps.policyEngine) {
      writeJson(res, 503, { error: 'Policy engine not available' });
      return true;
    }

    const results = await runPolicyEval(
      payloads,
      async (payload: typeof payloads[number]) => {
        const decision = await deps.policyEngine!.evaluateAsync({
          serverName: payload.server || 'eval-test',
          toolName: payload.tool,
          arguments: payload.args,
          requestId: `eval_${Date.now()}`,
          requestTokens: 100,
          timestamp: new Date().toISOString(),
          tenantId: deps.tenantId,
        } as any);
        return decision;
      },
    );

    const stats = computeEvalStats(results);
    writeJson(res, 200, { results, stats });
    return true;
  }

  // ── /api/widgets/* ──────────────────────────────────────────────────────
  if (url === '/widgets' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mastyf AI Widgets</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;color:#111827;margin:0;padding:24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;max-width:1200px;margin:0 auto}h1{font-size:24px;margin-bottom:24px}#block-rate,#system-status,#top-tools{min-height:120px}</style></head><body><h1>Mastyf AI Widgets</h1><div class="grid"><div id="block-rate"></div><div id="system-status"></div><div id="top-tools"></div></div><script>const apiBase='${deps.tenantId ? '/?tenant='+deps.tenantId : ''}';function fetchM(m){return fetch('/api/widgets/'+m).then(r=>r.json())}Promise.all([fetchM('metrics')]).then(([m])=>{const el=document.getElementById('block-rate');el.innerHTML='<div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px"><div style="font-size:14px;color:#6b7280;margin-bottom:12px">Block Rate</div><div style="font-size:48px;font-weight:700;color:#16a34a;line-height:1">'+m.blockRate.toFixed(1)+'%</div><div style="font-size:12px;color:#9ca3af;margin-top:8px">'+m.activePolicies+' policies | '+m.activeHooks+' hooks</div></div>';const ss=document.getElementById('system-status');ss.innerHTML='<div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px"><div style="font-size:14px;color:#6b7280;margin-bottom:12px">System</div><div style="display:flex;flex-direction:column;gap:8px"><div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e5e7eb"><span>Active Policies</span><span style="color:#16a34a;font-weight:500">'+m.activePolicies+'</span></div><div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e5e7eb"><span>Active Hooks</span><span style="color:#16a34a;font-weight:500">'+m.activeHooks+'</span></div></div></div>'}).catch(()=>{});</script></body></html>`);
    return true;
  }

  if (url === '/api/widgets/metrics' && method === 'GET') {
    setCors();
    const store = getPersistenceStore();
    const policies = store.getUserPolicies(deps.tenantId || 'default');
    const db = deps.db;
    let totalRequests = 0, blockedRequests = 0;
    if (db?.getCallRecordsForServer) {
      try {
        const records = await db.getCallRecordsForServer('__all__', 1000);
        totalRequests = records.length;
        blockedRequests = records.filter((r: any) => r.blocked).length;
      } catch {}
    }
    writeJson(res, 200, {
      totalRequests,
      blockedRequests,
      blockRate: totalRequests > 0 ? (blockedRequests / totalRequests * 100) : 0,
      activePolicies: policies.length,
      activeHooks: globalHookRegistry.listHooks().length,
      avgLatencyMs: 0,
      updatedAt: new Date().toISOString(),
    });
    return true;
  }

  if (url === '/api/widgets/audit' && method === 'GET') {
    setCors();
    writeJson(res, 200, {
      totalEvents: 0, blockedEvents: 0, allowedEvents: 0, flaggedEvents: 0,
      topBlockedTools: [], topBlockedRules: [],
      periodStart: '', periodEnd: '',
    });
    return true;
  }

  // ── /api/threat-feeds/* ─────────────────────────────────────────────────
  if (url === '/api/threat-feeds/subscriptions' && method === 'GET') {
    setCors();
    const store = getPersistenceStore();
    const rows = store.getFeedSubscriptions(deps.tenantId || 'default');
    const subs = rows.map(r => ({
      id: r.id, tenantId: r.tenant_id, name: r.name, feedUrl: r.feed_url,
      enabled: Boolean(r.enabled), lastSync: r.last_sync, addedCount: r.added_count, createdAt: r.created_at,
    }));
    writeJson(res, 200, { subscriptions: subs });
    return true;
  }

  if (url === '/api/threat-feeds/subscriptions' && method === 'POST') {
    setCors();
    const body = await parseBody(req);
    const store = getPersistenceStore();
    const id = `feed_${Date.now()}`;
    store.saveFeedSubscription({
      id, tenant_id: deps.tenantId || 'default', name: (body.name as string) || 'Custom Feed',
      feed_url: (body.feedUrl as string) || '', enabled: body.enabled !== false ? 1 : 0,
      last_sync: null, added_count: 0, created_at: new Date().toISOString(),
    });
    writeJson(res, 201, { subscription: { id, name: body.name, feedUrl: body.feedUrl, enabled: body.enabled !== false } });
    return true;
  }

  if (url.startsWith('/api/threat-feeds/sync') && method === 'POST') {
    setCors();
    const store = getPersistenceStore();
    const feeds = store.getFeedSubscriptions(deps.tenantId || 'default');
    let syncedCount = 0;
    for (const feed of feeds) {
      if (!feed.enabled) continue;
      try {
        const res = await fetch(feed.feed_url, { signal: AbortSignal.timeout(15000) });
        if (res.ok) {
          store.saveFeedSubscription({ ...feed, last_sync: new Date().toISOString(), added_count: feed.added_count + 1 });
          syncedCount++;
        }
      } catch {}
    }
    writeJson(res, 200, { synced: syncedCount, total: feeds.length });
    return true;
  }

  if (url === '/api/hooks' && method === 'POST') {
    setCors();
    const body = await parseBody(req);
    const { name, code, type, priority } = body;
    if (!name || !code || !type) { writeJson(res, 400, { error: 'name, code, and type are required' }); return true; }
    const hook = createCustomHook(name as string, code as string, type as any, (priority as number) || 50);
    if (!hook) { writeJson(res, 400, { error: 'Failed to create hook from code' }); return true; }
    if (type === 'before') globalHookRegistry.registerBefore(hook as any);
    else if (type === 'after') globalHookRegistry.registerAfter(hook as any);
    else globalHookRegistry.registerError(hook as any);
    const store = getPersistenceStore();
    store.saveCustomHook(name as string, code as string, type as string, (priority as number) || 50);
    writeJson(res, 201, { hooks: globalHookRegistry.listHooks() });
    return true;
  }

  if (url === '/api/hooks' && method === 'GET') {
    setCors();
    writeJson(res, 200, { hooks: globalHookRegistry.listHooks() });
    return true;
  }

  // ── /api/credentials/* ───────────────────────────────────────────────────
  if (url === '/api/learning/suggestions' && method === 'GET') {
    setCors();
    writeJson(res, 200, { suggestions: learningMode.getSuggestions() });
    return true;
  }

  if (url === '/api/learning/semantic/seed' && method === 'POST') {
    setCors();
    const store = getPersistenceStore();
    const entries = store.getCorpusEntries(false);
    if (entries.length === 0) { writeJson(res, 200, { seeded: 0 }); return true; }
    const { seedSemanticAuditFromBlocks } = await import('../ai/semantic-audit-store.js');
    const count = seedSemanticAuditFromBlocks(entries.map(e => ({
      tool: e.tool, args: e.args, category: e.category, description: e.description, expected_action: e.expected_action,
    })));
    writeJson(res, 200, { seeded: count, available: entries.length });
    return true;
  }

  if (url === '/api/audit/verify' && method === 'GET') {
    setCors();
    const store = getPersistenceStore();
    const result = store.verifyAuditChain ? store.verifyAuditChain() : { ok: true, breaks: 0, entries: 0 };
    writeJson(res, 200, result);
    return true;
  }

  if (url === '/api/credentials' && method === 'POST') {
    setCors();
    const body = await parseBody(req);
    const { credentialBroker } = await import('../auth/credential-broker.js');
    const id = await credentialBroker.storeCredential({
      tenantId: (body.tenantId as string) || 'default',
      userId: (body.userId as string) || 'system',
      providerName: (body.providerName as string) || 'api',
      providerId: (body.providerId as string) || 'default',
      credentialType: (body.credentialType as any) || 'bearer_token',
      token: body.token as string,
      refreshToken: body.refreshToken as string,
      scopes: (body.scopes as string[]) || [],
      expiresAt: body.expiresAt as number,
    });
    writeJson(res, 201, { id, ok: true });
    return true;
  }

  if (url === '/api/credentials' && method === 'GET') {
    setCors();
    const store = getPersistenceStore();
    const tenantId = (new URL(req.url!, 'http://localhost')).searchParams.get('tenantId') || 'default';
    const row = store.getCredentials(tenantId, 'default', 'bearer_token');
    writeJson(res, 200, { credentials: row ? [row] : [] });
    return true;
  }

  // ── /api/user-policies/* ─────────────────────────────────────────────────
  if (url === '/api/user-policies' && method === 'GET') {
    setCors();
    const store = getPersistenceStore();
    const rows = store.getUserPolicies(deps.tenantId || 'default');
    const policies = rows.map(r => {
      const safe = (s: string) => { try { return JSON.parse(s); } catch { return []; } };
      return {
        userId: r.user_id, username: r.username, tenantId: r.tenant_id,
        roles: safe(r.roles), allowedTools: safe(r.allowed_tools),
        deniedTools: safe(r.denied_tools), rateLimitPerMinute: r.rate_limit_per_minute,
        maxTokensPerCall: r.max_tokens_per_call, allowedPaths: safe(r.allowed_paths),
        deniedPaths: safe(r.denied_paths),
      };
    });
    writeJson(res, 200, { policies });
    return true;
  }

  if (url === '/api/user-policies' && method === 'POST') {
    setCors();
    const body = await parseBody(req);
    const store = getPersistenceStore();
    const id = `up_${(body.userId as string || 'anon').replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}`;
    store.saveUserPolicy({
      id, tenant_id: deps.tenantId || 'default', user_id: (body.userId as string) || 'anon',
      username: (body.username as string) || '', roles: JSON.stringify(body.roles || []),
      allowed_tools: JSON.stringify(body.allowedTools || []), denied_tools: JSON.stringify(body.deniedTools || []),
      rate_limit_per_minute: (body.rateLimitPerMinute as number) || 60,
      max_tokens_per_call: (body.maxTokensPerCall as number) || 5000,
      allowed_paths: JSON.stringify(body.allowedPaths || []), denied_paths: JSON.stringify(body.deniedPaths || []),
    });
    const engine = getUserToolEnforcementEngine();
    const policy: UserToolPolicy = {
      userId: (body.userId as string) || 'anon', username: (body.username as string) || '',
      tenantId: deps.tenantId || 'default', roles: (body.roles as string[]) || [],
      allowedTools: (body.allowedTools as string[]) || [], deniedTools: (body.deniedTools as string[]) || [],
      rateLimitPerMinute: (body.rateLimitPerMinute as number) || 60,
      maxTokensPerCall: (body.maxTokensPerCall as number) || 5000,
      allowedPaths: (body.allowedPaths as string[]) || [], deniedPaths: (body.deniedPaths as string[]) || [],
    };
    engine.registerUserPolicies([policy]);
    writeJson(res, 201, { ok: true });
    return true;
  }

  if (url === '/api/user-policies/roles' && method === 'POST') {
    setCors();
    const body = await parseBody(req);
    const engine = getUserToolEnforcementEngine();
    const rolePolicies = (body.policies as any[]) || [];
    engine.registerRolePolicies(rolePolicies.map(p => ({
      roleName: p.roleName as string, tenantId: deps.tenantId || 'default',
      allowedTools: (p.allowedTools as string[]) || [], deniedTools: (p.deniedTools as string[]) || [],
      rateLimitPerMinute: (p.rateLimitPerMinute as number) || 60,
      maxTokensPerCall: (p.maxTokensPerCall as number) || 5000,
      allowedPaths: (p.allowedPaths as string[]) || [], deniedPaths: (p.deniedPaths as string[]) || [],
    })));
    writeJson(res, 201, { ok: true });
    return true;
  }

  if (url.startsWith('/api/hooks/') && method === 'POST') {
    setCors();
    const hookName = url.replace('/api/hooks/', '');
    const body = await parseBody(req);
    if (body.action === 'disable') globalHookRegistry.disableHook(hookName);
    else if (body.action === 'enable') globalHookRegistry.enableHook(hookName);
    writeJson(res, 200, { hooks: globalHookRegistry.listHooks() });
    return true;
  }

  return false;
}
