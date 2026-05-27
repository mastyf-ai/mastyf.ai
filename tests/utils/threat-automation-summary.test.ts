import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildThreatAutomationSummary } from '../../src/utils/threat-automation-summary.js';
import { resolveTenantSwarmDir } from '../../src/tenant/swarm-tenant-paths.js';

const TENANT_ID = 'test-automation-summary';
const SWARM_DIR = resolveTenantSwarmDir(TENANT_ID);

describe('buildThreatAutomationSummary', () => {
  beforeEach(() => {
    mkdirSync(SWARM_DIR, { recursive: true });
    writeFileSync(
      join(SWARM_DIR, 'auto-corpus-manifest.json'),
      JSON.stringify({
        timestamp: new Date().toISOString(),
        count: 2,
        entries: [
          {
            advId: 'adv-1',
            relPath: 'fixtures/adv-1.json',
            fingerprint: 'fp-1',
            source: 'threat_intel',
            attackClass: 'prompt_injection',
            hypothesis: 'h1',
            confidence: 0.9,
            timestamp: new Date().toISOString(),
            toolName: 'notion.search',
            category: 'exfiltration',
          },
          {
            advId: 'adv-2',
            relPath: 'fixtures/adv-2.json',
            fingerprint: 'fp-2',
            source: 'semantic_flag',
            attackClass: 'prompt_injection',
            hypothesis: 'h2',
            confidence: 0.7,
            timestamp: new Date().toISOString(),
            toolName: 'github.read',
            category: 'exfiltration',
          },
        ],
      }),
    );
    writeFileSync(
      join(SWARM_DIR, 'threat-lab-candidates.json'),
      JSON.stringify({
        candidates: [
          { id: 'c1', attackClass: 'a', hypothesis: 'x', confidence: 0.8, reviewStatus: 'pending' },
          { id: 'c2', attackClass: 'a', hypothesis: 'y', confidence: 0.9, reviewStatus: 'accepted' },
        ],
      }),
    );
    writeFileSync(
      join(SWARM_DIR, 'learning-events.jsonl'),
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        type: 'threat_research_write',
        detail: 'adv-1 prompt_injection',
      })}\n`,
    );
  });

  afterEach(() => {
    if (existsSync(SWARM_DIR)) rmSync(SWARM_DIR, { recursive: true, force: true });
  });

  it('includes persisted corpus and threat-lab artifacts in automation summary', async () => {
    const summary = await buildThreatAutomationSummary(TENANT_ID);

    expect(summary.autoCorpus.total).toBe(2);
    expect(summary.autoCorpus.last24h).toBe(2);
    expect(summary.threatLab.total).toBe(2);
    expect(summary.threatLab.pending).toBe(1);
    expect(summary.learning.counts24h.threat_research_write).toBe(1);
  });
});
