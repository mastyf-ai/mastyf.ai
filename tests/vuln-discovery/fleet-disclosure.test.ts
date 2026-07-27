import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vuln store paths', () => {
  const prevStore = process.env.MASTYF_AI_VULN_STORE_DIR;
  const prevHome = process.env.MASTYF_AI_HOME;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vuln-paths-'));
    delete process.env.MASTYF_AI_HOME;
    process.env.MASTYF_AI_VULN_STORE_DIR = dir;
  });

  afterEach(() => {
    if (prevStore === undefined) delete process.env.MASTYF_AI_VULN_STORE_DIR;
    else process.env.MASTYF_AI_VULN_STORE_DIR = prevStore;
    if (prevHome === undefined) delete process.env.MASTYF_AI_HOME;
    else process.env.MASTYF_AI_HOME = prevHome;
    rmSync(dir, { recursive: true, force: true });
  });

  it('prefers MASTYF_AI_VULN_STORE_DIR over HOME', async () => {
    process.env.MASTYF_AI_HOME = join(dir, 'ignored-home');
    const {
      getVulnStoreDir,
      vulnFindingsPath,
      vulnLiveStatsPath,
      vulnPrecisionPath,
      vulnReportsDir,
      vulnDisclosureDir,
    } = await import('../../src/vuln-discovery/paths.js');
    expect(getVulnStoreDir()).toBe(dir);
    expect(vulnFindingsPath()).toBe(join(dir, 'vuln-findings.jsonl'));
    expect(vulnLiveStatsPath()).toBe(join(dir, 'vuln-live-traffic-stats.json'));
    expect(vulnPrecisionPath()).toBe(join(dir, 'vuln-precision-metrics.json'));
    expect(vulnReportsDir()).toBe(join(dir, 'vuln-reports'));
    expect(vulnDisclosureDir('f1')).toBe(join(dir, 'vuln-disclosure', 'f1'));
  });

  it('falls back to MASTYF_AI_HOME when store dir unset', async () => {
    delete process.env.MASTYF_AI_VULN_STORE_DIR;
    process.env.MASTYF_AI_HOME = join(dir, 'home');
    const { getVulnStoreDir } = await import('../../src/vuln-discovery/paths.js');
    expect(getVulnStoreDir()).toBe(join(dir, 'home'));
  });
});

describe('live-traffic-stats fleet merge', () => {
  const prevStore = process.env.MASTYF_AI_VULN_STORE_DIR;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vuln-stats-'));
    process.env.MASTYF_AI_VULN_STORE_DIR = dir;
  });

  afterEach(async () => {
    const { resetLiveTrafficStatsForTests } = await import(
      '../../src/vuln-discovery/live-traffic-stats.js'
    );
    resetLiveTrafficStatsForTests();
    if (prevStore === undefined) delete process.env.MASTYF_AI_VULN_STORE_DIR;
    else process.env.MASTYF_AI_VULN_STORE_DIR = prevStore;
    rmSync(dir, { recursive: true, force: true });
  });

  it('reloads and merges max counters from disk', async () => {
    const statsPath = join(dir, 'vuln-live-traffic-stats.json');
    writeFileSync(
      statsPath,
      JSON.stringify([
        {
          key: 'srv:tool',
          serverName: 'srv',
          toolName: 'tool',
          allowCount: 5,
          maliciousShapedCount: 2,
          softDenyCount: 3,
          lastSeenAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    );

    const {
      resetLiveTrafficStatsForTests,
      recordLiveAllow,
      getLiveTrafficStats,
      reloadLiveTrafficStatsFromDisk,
    } = await import('../../src/vuln-discovery/live-traffic-stats.js');
    resetLiveTrafficStatsForTests();
    reloadLiveTrafficStatsFromDisk();
    recordLiveAllow('srv', 'tool');
    // Peer wrote higher counters to disk
    writeFileSync(
      statsPath,
      JSON.stringify([
        {
          key: 'srv:tool',
          serverName: 'srv',
          toolName: 'tool',
          allowCount: 50,
          maliciousShapedCount: 9,
          softDenyCount: 7,
          lastSeenAt: '2026-07-01T00:00:00.000Z',
        },
      ]),
    );
    const rows = getLiveTrafficStats();
    const row = rows.find((r) => r.key === 'srv:tool');
    expect(row).toBeTruthy();
    expect(row!.allowCount).toBeGreaterThanOrEqual(50);
    expect(row!.maliciousShapedCount).toBe(9);
    expect(row!.softDenyCount).toBe(7);
  });
});

describe('disclosure package', () => {
  const prevStore = process.env.MASTYF_AI_VULN_STORE_DIR;
  const prevTemplate = process.env.MASTYF_AI_VULN_ANALYSIS_ALLOW_TEMPLATE;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vuln-disclose-'));
    process.env.MASTYF_AI_VULN_STORE_DIR = dir;
    process.env.MASTYF_AI_VULN_ANALYSIS_ALLOW_TEMPLATE = 'true';
  });

  afterEach(() => {
    if (prevStore === undefined) delete process.env.MASTYF_AI_VULN_STORE_DIR;
    else process.env.MASTYF_AI_VULN_STORE_DIR = prevStore;
    if (prevTemplate === undefined) delete process.env.MASTYF_AI_VULN_ANALYSIS_ALLOW_TEMPLATE;
    else process.env.MASTYF_AI_VULN_ANALYSIS_ALLOW_TEMPLATE = prevTemplate;
    rmSync(dir, { recursive: true, force: true });
  });

  it('includes evidence + fullText and never invents CVE', async () => {
    const {
      upsertFinding,
      createFindingId,
      fingerprintFinding,
    } = await import('../../src/vuln-discovery/store.js');
    const { saveReport } = await import('../../src/vuln-discovery/vuln-analyst.js');
    const {
      buildDisclosurePackage,
      zipStoreFiles,
      readDisclosurePackageZip,
    } = await import('../../src/vuln-discovery/disclosure-package.js');

    const partial = {
      class: 'injection' as const,
      severity: 'HIGH' as const,
      status: 'validated' as const,
      title: 'Leaked secret via tool result',
      description: 'Tool returned API key material',
      target: { kind: 'tool_handler' as const, name: 'leaky:read' },
      evidence: {
        scanner: 'live-traffic-tap',
        reproSteps: ['call leaky:read with traversal', 'observe secret in result'],
        payloads: [{ path: '../../../.env' }],
        request: { tool: 'read', args: { path: '../../../.env' } },
        response: { content: [{ type: 'text', text: 'API_KEY=sk-test' }] },
        rule: 'EXPLOIT_EFFECT',
      },
      exploitability: {
        preAuth: false,
        networkReachable: true,
        userInteraction: false,
      },
    };
    const fp = fingerprintFinding({
      class: partial.class,
      target: partial.target,
      title: partial.title,
      evidence: { scanner: partial.evidence.scanner, reproSteps: partial.evidence.reproSteps },
    });
    const id = createFindingId(fp);
    upsertFinding({
      ...partial,
      id,
      fingerprint: fp,
      discoveredAt: new Date().toISOString(),
      validatedAt: new Date().toISOString(),
    });

    const sections = {
      executiveSummary: 'A high severity leak was observed.',
      technicalDeepDive: 'Tool returned secrets after traversal payload.',
      exploitScenario: 'Attacker crafts path traversal.',
      impactAssessment: 'Credential exposure.',
      affectedComponents: 'leaky:read',
      evidenceAndRepro: 'See payloads.',
      similarPublishedCves: 'No published CVE in evidence.',
      estimatedSeverity: 'HIGH',
      mitigations: 'Block path traversal and scan tool results for secrets.',
      mastyfRecommendations: 'Enable response scanning and propose block in Threat Lab.',
      disclosureGuidance:
        'Contact the maintainer privately with repro steps; do not invent a CVE ID — request one from a CNA after confirmation.',
    };
    const fullText = `# ${partial.title}\n\n${sections.executiveSummary}\n\n## Disclosure Guidance\n${sections.disclosureGuidance}`;
    saveReport({
      id: `analysis-${id}-test`,
      findingId: id,
      generatedAt: new Date().toISOString(),
      status: 'draft',
      provider: 'test',
      model: 'fixture',
      format: 'markdown',
      sections,
      fullText,
      citations: [{ id: 'c1', kind: 'evidence', excerpt: 'API_KEY=sk-test' }],
      confidence: 0.8,
      source: 'llm',
    });

    const pkg = await buildDisclosurePackage(id);
    expect(pkg.cveStatus).toBe('none');
    expect(pkg.relatedCve).toBeUndefined();
    expect(pkg.preview).toBe(true);
    expect(pkg.vendorReady).toBe(false);
    expect(pkg.evidence.scanner).toBe('live-traffic-tap');
    expect(pkg.evidence.payloads).toEqual([{ path: '../../../.env' }]);
    expect(pkg.report.fullText).toContain(partial.title);
    expect(pkg.vendorSummary.disclosureGuidance.length).toBeGreaterThan(40);
    expect(JSON.stringify(pkg)).not.toMatch(/CVE-202[0-9]-\d+/);

    expect(existsSync(pkg.paths.packageJson)).toBe(true);
    expect(existsSync(pkg.paths.reportMd)).toBe(true);
    expect(existsSync(pkg.paths.readme)).toBe(true);
    expect(existsSync(pkg.paths.zip!)).toBe(true);

    const zip = readDisclosurePackageZip(id);
    expect(zip).toBeTruthy();
    expect(zip![0]).toBe(0x50); // 'P'
    expect(zip![1]).toBe(0x4b); // 'K'
    const zipStr = zip!.toString('binary');
    expect(zipStr).toContain('report.md');
    expect(zipStr).toContain('disclosure-package.json');
    expect(zipStr).toContain('README.md');

    const roundTrip = zipStoreFiles([{ name: 'a.txt', data: 'hello' }]);
    expect(roundTrip.slice(0, 2).toString()).toBe('PK');
  });

  it('links relatedCve when already on finding', async () => {
    const {
      upsertFinding,
      createFindingId,
      fingerprintFinding,
    } = await import('../../src/vuln-discovery/store.js');
    const { saveReport } = await import('../../src/vuln-discovery/vuln-analyst.js');
    const { buildDisclosurePackage } = await import('../../src/vuln-discovery/disclosure-package.js');

    const partial = {
      class: 'dependency' as const,
      severity: 'MEDIUM' as const,
      status: 'validated' as const,
      title: 'Known advisory linked',
      description: 'Package advisory',
      target: { kind: 'npm_package' as const, name: 'left-pad' },
      relatedCve: 'CVE-2024-12345',
      evidence: {
        scanner: 'cve-checker',
        reproSteps: ['npm audit', 'confirm advisory'],
      },
      exploitability: {
        preAuth: false,
        networkReachable: false,
        userInteraction: true,
      },
    };
    const fp = fingerprintFinding({
      class: partial.class,
      target: partial.target,
      title: partial.title,
      evidence: { scanner: partial.evidence.scanner, reproSteps: partial.evidence.reproSteps },
    });
    const id = createFindingId(fp);
    upsertFinding({
      ...partial,
      id,
      fingerprint: fp,
      discoveredAt: new Date().toISOString(),
    });
    saveReport({
      id: `analysis-${id}-test`,
      findingId: id,
      generatedAt: new Date().toISOString(),
      status: 'final',
      provider: 'test',
      model: 'fixture',
      format: 'markdown',
      sections: {
        executiveSummary: 'Linked CVE.',
        technicalDeepDive: 'dep',
        exploitScenario: 'n/a',
        impactAssessment: 'med',
        affectedComponents: 'left-pad',
        evidenceAndRepro: 'audit',
        similarPublishedCves: 'CVE-2024-12345',
        estimatedSeverity: 'MEDIUM',
        mitigations: 'Upgrade the dependency to a patched release when available from upstream.',
        mastyfRecommendations: 'Track in Threat Lab.',
        disclosureGuidance: 'Already published — cite the existing CVE when notifying stakeholders.',
      },
      fullText: '# Known advisory\n\nLinked CVE-2024-12345',
      citations: [],
      confidence: 0.9,
      source: 'llm',
    });

    const pkg = await buildDisclosurePackage(id);
    expect(pkg.cveStatus).toBe('linked');
    expect(pkg.relatedCve).toBe('CVE-2024-12345');
    expect(pkg.vendorReady).toBe(true);
  });
});

describe('start-env LIVE_TAP wiring', () => {
  const prev = {
    vde: process.env.MASTYF_AI_VULN_DISCOVERY_ENABLED,
    tap: process.env.MASTYF_AI_VULN_LIVE_TAP,
    store: process.env.MASTYF_AI_VULN_STORE_DIR,
    home: process.env.MASTYF_AI_HOME,
  };

  afterEach(() => {
    for (const [k, v] of Object.entries({
      MASTYF_AI_VULN_DISCOVERY_ENABLED: prev.vde,
      MASTYF_AI_VULN_LIVE_TAP: prev.tap,
      MASTYF_AI_VULN_STORE_DIR: prev.store,
      MASTYF_AI_HOME: prev.home,
    })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('enables LIVE_TAP when VDE is true unless explicitly false', async () => {
    process.env.MASTYF_AI_VULN_DISCOVERY_ENABLED = 'true';
    delete process.env.MASTYF_AI_VULN_LIVE_TAP;
    delete process.env.MASTYF_AI_VULN_STORE_DIR;
    process.env.MASTYF_AI_HOME = '/tmp/mastyf-test-home';
    const { applyStartEnv } = await import('../../src/utils/start-env.js');
    applyStartEnv();
    expect(process.env.MASTYF_AI_VULN_LIVE_TAP).toBe('true');
    expect(process.env.MASTYF_AI_VULN_STORE_DIR).toBe('/tmp/mastyf-test-home');
  });

  it('respects LIVE_TAP=false', async () => {
    process.env.MASTYF_AI_VULN_DISCOVERY_ENABLED = 'true';
    process.env.MASTYF_AI_VULN_LIVE_TAP = 'false';
    const { applyStartEnv } = await import('../../src/utils/start-env.js');
    applyStartEnv();
    expect(process.env.MASTYF_AI_VULN_LIVE_TAP).toBe('false');
  });
});
