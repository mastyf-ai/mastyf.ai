#!/usr/bin/env tsx
/**
 * Node batch eval — decisions keyed by string id for parity (no integer index lookup).
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { PolicyEngine } from '../../src/policy/policy-engine.js';
import { resetSessionFlowHistory } from '../../src/policy/session-flow-store.js';
import { resetTimingProbeCounters } from '../../src/policy/timing-guard.js';
import type { CallContext, PolicyConfig } from '../../src/policy/policy-types.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const REPO = join(__dir, '../..');
const OUT = join(ROOT, 'reports', 'node-batch-by-id.json');

interface FixtureEntry {
  id: string;
  category?: string;
  expected?: string;
  policyMode?: string;
  isolatedPolicy?: PolicyConfig['policy'];
  context?: Partial<CallContext> & { agentIdentity?: CallContext['agentIdentity'] };
  toolName?: string;
  arguments?: Record<string, unknown>;
}

function isolatedKey(entry: FixtureEntry): string {
  if (entry.category === 'rate-limit-evasion') return 'isolated:rate-limit-evasion';
  if (entry.category === 'token-evasion') return 'isolated:token-evasion';
  if (entry.category === 'rbac-evasion') return 'isolated:rbac-evasion';
  return `isolated:${entry.id}`;
}

function fixtureId(source: string, rel: string, data: Record<string, unknown>): string {
  return String(data.id ?? `${source}:${rel}`);
}

function loadFixtures(dir: string, source: string): FixtureEntry[] {
  const out: FixtureEntry[] = [];
  try {
    if (!statSync(dir).isDirectory()) return out;
  } catch {
    return out;
  }
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...loadFixtures(full, source));
    } else if (name.endsWith('.json')) {
      const data = JSON.parse(readFileSync(full, 'utf-8')) as Record<string, unknown>;
      const rel = relative(dir, full);
      out.push({ ...(data as FixtureEntry), id: fixtureId(source, rel, data) });
    }
  }
  return out;
}

function evaluateEntry(
  entry: FixtureEntry,
  defaultEngine: PolicyEngine,
  isolatedEngines: Map<string, PolicyEngine>,
): { action: string; rule: string; reason: string; blocked: boolean } {
  if (entry.policyMode === 'isolated' && entry.isolatedPolicy) {
    const key = isolatedKey(entry);
    let eng = isolatedEngines.get(key);
    if (!eng) {
      eng = new PolicyEngine({ version: '1.0', policy: entry.isolatedPolicy });
      isolatedEngines.set(key, eng);
    }
    const ctx = (entry.context ?? {
      toolName: entry.toolName ?? 'search',
      arguments: entry.arguments ?? {},
    }) as CallContext;
    const d = eng.evaluate(ctx, { yamlOnly: true });
    return {
      action: d.action,
      rule: d.rule,
      reason: d.reason,
      blocked: d.action === 'block' || d.action === 'flag',
    };
  }

  const ctx: CallContext = {
    serverName: 'harness',
    toolName: (entry.toolName ?? entry.context?.toolName ?? 'search') as string,
    arguments: (entry.arguments ?? entry.context?.arguments ?? {}) as Record<string, unknown>,
    requestId: 'harness',
    requestTokens: entry.context?.requestTokens ?? 50,
    timestamp: new Date().toISOString(),
    sessionId: `harness:${entry.id}`,
    tenantId: entry.context?.tenantId,
    agentIdentity: entry.context?.agentIdentity,
  };
  resetSessionFlowHistory();
  resetTimingProbeCounters();
  const d = defaultEngine.evaluate(ctx);
  return {
    action: d.action,
    rule: d.rule,
    reason: d.reason,
    blocked: d.action === 'block' || d.action === 'flag',
  };
}

function main() {
  const policy = load(readFileSync(join(REPO, 'default-policy.yaml'), 'utf-8')) as PolicyConfig;
  const defaultEngine = new PolicyEngine(policy);
  const isolatedEngines = new Map<string, PolicyEngine>();

  const fixtures = [
    ...loadFixtures(join(REPO, 'corpus'), 'corpus'),
    ...loadFixtures(join(ROOT, 'fixtures', 'matrix'), 'matrix'),
    ...loadFixtures(join(ROOT, 'fixtures', 'custom-attacks'), 'custom'),
  ];

  const byId: Record<string, { action: string; rule: string; reason: string; blocked: boolean }> = {};
  for (const entry of fixtures) {
    byId[entry.id] = evaluateEntry(entry, defaultEngine, isolatedEngines);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ timestamp: new Date().toISOString(), count: fixtures.length, byId }, null, 2));
  console.log(JSON.stringify({ count: fixtures.length, out: OUT }));
}

main();
