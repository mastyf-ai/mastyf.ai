#!/usr/bin/env npx tsx
/**
 * Batch auto threat research — bypasses, ThreatIntel, corpus seeds → adv fixtures.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { exitUnlessProFeature } from '../../src/license/enforce-pro.js';
import {
  buildBypassEvent,
  buildCorpusProactiveEvents,
  buildBlockRepeatEventsFromAttackState,
  buildSemanticFlagEvent,
  buildThreatIntelEvent,
  countProcessedFingerprints,
  filterUnprocessedEvents,
  processThreatResearchBatch,
  threatResearchAutoEnabled,
  type ThreatResearchEvent,
} from '../../src/ai/threat-research-pipeline.js';
import { getSharedThreatIntel } from '../../src/ai/threat-intel.js';
import { loadSemanticAuditRecordsAsync } from '../../src/ai/semantic-audit-store.js';
import { isCalibratorSeededRecord, semanticFlagMinConfidence, type BypassContext } from '../../src/ai/threat-lab.js';
import { resolveSwarmOutputDir } from '../../src/tenant/swarm-tenant-paths.js';

await exitUnlessProFeature('swarm');

const REPO = process.cwd();
const OUT_DIR = resolveSwarmOutputDir();

function loadJson(path: string): unknown {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function collectBypasses(): BypassContext[] {
  const bypassSources = [
    loadJson(join(OUT_DIR, 'bypasses.json')),
    loadJson(join(REPO, 'adversarial-harness', 'reports', 'comprehensive-eval.json')),
    loadJson(join(REPO, 'adversarial-harness', 'reports', 'parity-report.json')),
  ];
  const bypasses: BypassContext[] = [];
  for (const src of bypassSources) {
    if (!src || typeof src !== 'object') continue;
    const s = src as Record<string, unknown>;
    const list = (s.bypasses || s.items) as unknown[];
    if (Array.isArray(list)) {
      for (const b of list) {
        if (b && typeof b === 'object' && (b as { _netNew?: boolean })._netNew !== false) {
          bypasses.push(b as BypassContext);
        }
      }
    }
    const failures = s.failures as unknown[];
    if (Array.isArray(failures)) {
      for (const f of failures) {
        if (
          f &&
          typeof f === 'object' &&
          (f as { expected?: string; actual?: string }).expected === 'block' &&
          (f as { actual?: string }).actual === 'allow'
        ) {
          bypasses.push(f as BypassContext);
        }
      }
    }
  }
  return bypasses;
}

async function main(): Promise<void> {
  if (!threatResearchAutoEnabled()) {
    console.log(
      '[auto-threat-research] disabled — set GUARDIAN_THREAT_RESEARCH_AUTO=true and SWARM_THREAT_RESEARCH_AUTO=true',
    );
    process.exit(0);
  }

  const max = parseInt(process.env.SWARM_THREAT_RESEARCH_MAX || '10', 10);
  const candidates: ThreatResearchEvent[] = [];

  for (const ev of buildBlockRepeatEventsFromAttackState(max * 2)) {
    if (candidates.length >= max * 3) break;
    candidates.push(ev);
  }

  for (const b of collectBypasses()) {
    if (candidates.length >= max * 3) break;
    candidates.push(buildBypassEvent(b));
  }

  if (process.env.GUARDIAN_THREAT_RESEARCH_SEMANTIC !== 'false') {
    const records = await loadSemanticAuditRecordsAsync({ sinceMs: 7 * 24 * 60 * 60 * 1000, limit: 50 });
    for (const rec of records) {
      if (candidates.length >= max * 3) break;
      if (isCalibratorSeededRecord(rec)) continue;
      if (!rec.semanticAudit?.suspicious) continue;
      if ((rec.semanticAudit.confidence ?? 0) < semanticFlagMinConfidence()) continue;
      candidates.push(buildSemanticFlagEvent(rec));
    }
  }

  if (process.env.GUARDIAN_THREAT_RESEARCH_THREAT_INTEL !== 'false') {
    const ti = getSharedThreatIntel();
    try {
      await ti.pollLiveFeeds();
    } catch (err) {
      console.log(`[auto-threat-research] ThreatIntel poll warning: ${err instanceof Error ? err.message : String(err)}`);
    }
    for (const entry of ti.getCatalogEntries({ minSeverity: 'MEDIUM', limit: max * 2 })) {
      if (candidates.length >= max * 3) break;
      candidates.push(buildThreatIntelEvent(entry));
    }
  }

  if (process.env.SWARM_THREAT_RESEARCH_PROACTIVE !== 'false') {
    for (const ev of buildCorpusProactiveEvents(max * 2)) {
      if (candidates.length >= max * 3) break;
      candidates.push(ev);
    }
  }

  const events = filterUnprocessedEvents(candidates).slice(0, max);
  if (events.length === 0) {
    console.log(
      `[auto-threat-research] wrote 0/0 fixture(s) — all ${candidates.length} candidate signal(s) already processed (${countProcessedFingerprints()} in ledger). Route new MCP blocks through Guardian for fresh block-repeat signals.`,
    );
    return;
  }

  const results = await processThreatResearchBatch(events);
  const ok = results.filter((r) => r.ok);
  console.log(`[auto-threat-research] wrote ${ok.length}/${results.length} fixture(s)`);
  for (const r of ok) {
    console.log(`  ✓ ${r.advId} → ${r.relPath}`);
  }
  for (const r of results.filter((x) => !x.ok)) {
    console.log(`  ✗ ${r.reason}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
