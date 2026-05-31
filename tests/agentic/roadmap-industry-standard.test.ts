import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  policyToNaturalLanguage,
  naturalLanguageToPolicy,
} from '../../src/agentic/semantic-policy/translator.js';
import { ConfigProvenanceChain } from '../../src/agentic/provenance/config-provenance-chain.js';
import { exportSignedProvenanceBundle, verifySignedProvenanceBundle, writeSignedProvenanceTarball } from '../../src/agentic/provenance/provenance-export.js';
import {
  buildDfdFromConfig,
  buildToolThreats,
  controlMapperMitigations,
  generateThreatModelFromConfig,
  threatModelToMarkdown,
} from '../../src/agentic/threat-modeling/stride-linddun.js';
import { BehaviorFingerprintEngine } from '../../src/agentic/biometrics/behavior-fingerprint.js';
import { FleetChainDetector } from '../../src/agentic/cross-chain/fleet-chain-detector.js';
import { formatCefLine, fleetAlertToCef } from '../../src/agentic/cross-chain/siem-export.js';
import { DigitalTwinCapture } from '../../src/agentic/digital-twin/twin-capture.js';
import { ZeroTrustVerificationEngine } from '../../src/agentic/zero-trust/verification-engine.js';
import { ReputationNetwork } from '../../src/agentic/reputation/reputation-network.js';
import { EcosystemObservatory } from '../../src/agentic/observatory/ecosystem-observatory.js';
import {
  ingestFleetHeartbeatIntoObservatory,
  ingestGuardianBenchIntoObservatory,
  ingestMtxCatalogIntoObservatory,
} from '../../src/agentic/observatory/observatory-ingest.js';
import { InsuranceRiskQuantifier } from '../../src/agentic/insurance/risk-quantifier.js';
import { writeInsuranceRiskPdf } from '../../src/agentic/insurance/insurance-pdf-export.js';
import { FederatedLearningCoordinator } from '../../src/agentic/federated/federated-learning.js';
import { shouldShareFederatedDelta, federatedPrivacyConfig } from '../../src/agentic/federated/federated-privacy.js';
import { publishReputationViaMeshRelay } from '../../src/agentic/reputation/mesh-relay-publish.js';
import { SandboxTierEnforcer } from '../../src/agentic/sandbox-tier/enforcer.js';
import { adjustSandboxTierForZeroTrust } from '../../src/agentic/zero-trust/tier-adjuster.js';
import { getActiveSpiffeId } from '../../src/utils/mtls-config.js';
import {
  storePolicyDraft,
  markPolicyDraftApproved,
  markPolicyDraftApplied,
  clearPolicyDraftsForTests,
} from '../../src/agentic/semantic-policy/policy-approval-store.js';

describe('C5 semantic policy translator', () => {
  it('explains policy config heuristically', async () => {
    const summary = await policyToNaturalLanguage(
      {
        version: '1.0',
        policy: {
          mode: 'block',
          rules: [{ name: 'deny-curl', action: 'block', tools: { deny: ['curl'] } }],
        },
      },
      { useLlm: false },
    );
    expect(summary.ruleCount).toBe(1);
    expect(summary.overview).toMatch(/1 rule/i);
    expect(summary.sections.some(s => s.title === 'deny-curl')).toBe(true);
  });

  it('generates draft from natural language goal', async () => {
    const draft = await naturalLanguageToPolicy('block execute_command', { skipReplay: true });
    expect(draft).not.toBeNull();
    expect(draft!.rule.name).toBeTruthy();
    expect(draft!.yaml).toMatch(/execute_command|deny|block/i);
  });
});

describe('C1 config provenance chain', () => {
  it('maintains verifiable hash chain', () => {
    const chain = new ConfigProvenanceChain();
    const e1 = chain.append({
      actor: 'test',
      eventType: 'policy_apply',
      resourcePath: '/tmp/policy.yaml',
      diff: { rule: 'a' },
    });
    const e2 = chain.append({
      actor: 'test',
      eventType: 'policy_apply',
      resourcePath: '/tmp/policy.yaml',
      diff: { rule: 'b' },
    });
    const result = chain.verify([e1, e2]);
    expect(result.valid).toBe(true);
    expect(result.eventCount).toBe(2);
  });

  it('detects tampered entries', () => {
    const chain = new ConfigProvenanceChain();
    const e1 = chain.append({
      actor: 'test',
      eventType: 'policy_apply',
      resourcePath: '/tmp/policy.yaml',
    });
    const tampered = { ...e1, entryHash: 'deadbeef' };
    const result = chain.verify([tampered]);
    expect(result.valid).toBe(false);
  });
});

describe('C2 threat modeling', () => {
  it('builds DFD and STRIDE rows from servers', () => {
    const servers = [{
      name: 'filesystem',
      tools: [{ name: 'read_file', description: 'Read a file' }, { name: 'execute_command', description: 'Run shell' }],
    }];
    const { nodes, edges } = buildDfdFromConfig(servers);
    expect(nodes.some(n => n.id === 'proxy')).toBe(true);
    expect(edges.some(e => e.from.includes('filesystem'))).toBe(true);
    const threats = buildToolThreats(servers, controlMapperMitigations(['deny-curl']));
    expect(threats.length).toBe(2);
    expect(threats[0]!.mitigations.some(m => m.includes('CC6'))).toBe(true);
    const md = threatModelToMarkdown({
      title: 'Test',
      generatedAt: new Date().toISOString(),
      nodes,
      edges,
      toolThreats: threats,
      summary: 'test',
    });
    expect(md).toMatch(/STRIDE/);
    expect(md).toMatch(/execute_command/);
  });

  it('matches golden THREATS.md structure', () => {
    const golden = readFileSync(join(process.cwd(), 'tests/fixtures/THREATS.golden.md'), 'utf-8');
    const md = threatModelToMarkdown({
      title: 'Threat Model — Golden Fixture',
      generatedAt: new Date().toISOString(),
      nodes: [
        { id: 'client', type: 'client', label: 'AI Agent / Client' },
        { id: 'proxy', type: 'proxy', label: 'MCP Guardian Proxy' },
      ],
      edges: [{ from: 'client', to: 'proxy', label: 'JSON-RPC' }],
      toolThreats: buildToolThreats([{
        name: 'filesystem',
        tools: [{ name: 'execute_command', description: 'Run shell' }],
      }], controlMapperMitigations([])),
      summary: 'Golden reference for STRIDE/LINDDUN threat model output.',
    });
    for (const heading of ['## Summary', '## Data Flow Diagram', '## STRIDE / LINDDUN per Tool', '**STRIDE**', '**Mitigations**']) {
      expect(md).toContain(heading);
      expect(golden).toContain(heading);
    }
  });

  it('generates proxy-filesystem golden threat model deterministically', () => {
    const configPath = 'scenarios/real-life/proxy-filesystem-config.json';
    const report = generateThreatModelFromConfig(configPath, ['deny-curl']);
    const md = threatModelToMarkdown(report).replace(/^Generated:.*$/m, 'Generated: FIXED').trim();
    const goldenPath = join(process.cwd(), 'tests/fixtures/THREATS.proxy-filesystem.golden.md');
    const golden = readFileSync(goldenPath, 'utf-8').replace(/^Generated:.*$/m, 'Generated: FIXED').trim();
    expect(md).toBe(golden);
  });
});

describe('A3 behavioral biometrics', () => {
  it('requires 50+ samples before anomaly scoring', () => {
    const engine = new BehaviorFingerprintEngine();
    const agentId = 'agent-test-1';
    for (let i = 0; i < 49; i++) {
      engine.observe({
        agentId,
        toolName: 'search',
        argBytes: 100,
        interCallMs: 500,
        timestamp: Date.now() + i * 500,
        credentialIdentity: 'user-a',
      });
    }
    const early = engine.scoreAnomaly(agentId, {
      agentId,
      toolName: 'search',
      argBytes: 100,
      interCallMs: 5000,
      timestamp: Date.now(),
      credentialIdentity: 'user-b',
    });
    expect(early.score).toBe(0);
    expect(early.reason).toMatch(/Insufficient baseline/);

    engine.observe({
      agentId,
      toolName: 'search',
      argBytes: 100,
      interCallMs: 500,
      timestamp: Date.now() + 50_000,
      credentialIdentity: 'user-a',
    });
    const anomaly = engine.scoreAnomaly(agentId, {
      agentId,
      toolName: 'search',
      argBytes: 100,
      interCallMs: 5000,
      timestamp: Date.now(),
      credentialIdentity: 'user-b',
    });
    expect(anomaly.score).toBeGreaterThan(0.3);
  });
});

describe('Phase 2 roadmap modules', () => {
  it('A1 fleet chain detector records cross-server events and alerts', () => {
    const detector = new FleetChainDetector();
    detector.record({ globalSessionId: 'sess-1', agentId: 'a1', serverName: 'srv-a', toolName: 'read_file' });
    const alert = detector.record({ globalSessionId: 'sess-1', agentId: 'a1', serverName: 'srv-b', toolName: 'http_request' });
    expect(alert).not.toBeNull();
    expect(alert!.confidence).toBeGreaterThanOrEqual(0.65);
    expect(detector.getAlerts().length).toBeGreaterThanOrEqual(1);
  });

  it('A2 digital twin scorecard go/no-go', () => {
    const twin = new DigitalTwinCapture();
    twin.record({ serverName: 'echo', toolName: 'search', latencyMs: 50, responseShape: '{}' });
    const snap = twin.snapshot('echo');
    expect(snap?.sampleCount).toBe(1);
    const score = twin.scoreSandbox({
      attacksBlocked: 90,
      attacksTotal: 100,
      workflowsPreserved: 98,
      workflowsTotal: 100,
      baselineP99Ms: 100,
      sandboxP99Ms: 120,
    });
    expect(score.goNoGo).toBe('go');
  });

  it('C3 zero-trust engine returns composite score with SPIFFE dimension', () => {
    const engine = new ZeroTrustVerificationEngine();
    const score = engine.score({
      agentId: 'a1',
      sessionId: 's1',
      serverName: 'filesystem',
      toolName: 'read_file',
      authenticated: true,
      spiffeId: 'spiffe://guardian/agent/a1',
    });
    expect(score.composite).toBeGreaterThan(0);
    expect(score.dimensions.spiffe).toBeGreaterThan(0.9);
    expect(['allow', 'step_up', 'block']).toContain(score.action);
  });
});

describe('Phase 3 roadmap modules', () => {
  it('B1 reputation network rates and queries servers', async () => {
    const net = new ReputationNetwork();
    const entry = net.rateServer({
      serverName: 'filesystem',
      dimensions: { security_posture: 80, auth_strength: 70 },
    });
    expect(entry.consensusScore).toBeGreaterThan(0);
    expect(net.queryServerReputation('filesystem')).not.toBeNull();
    const mesh = await publishReputationViaMeshRelay('filesystem', entry);
    expect(mesh.via).toBe('none');
  });

  it('B2 observatory snapshot aggregates metrics', () => {
    const obs = new EcosystemObservatory();
    obs.ingestBenchmarkSubmission({ blockRate: 0.95, falsePositiveRate: 0.01, serverCount: 5 });
    ingestGuardianBenchIntoObservatory(obs, { blockRate: 0.9, falsePositiveRate: 0.02, serverCount: 3 });
    ingestFleetHeartbeatIntoObservatory(obs, { instanceCount: 2, blockRate: 0.88 });
    ingestMtxCatalogIntoObservatory(obs, [{ category: 'prompt-injection' }, { category: 'prompt-injection' }]);
    const snap = obs.snapshot();
    expect(snap.avgBlockRate).toBeGreaterThan(0);
  });

  it('C4 insurance quantifier computes ALE and exports PDF', () => {
    const q = new InsuranceRiskQuantifier();
    const report = q.quantify({
      serverName: 'filesystem',
      toolCount: 20,
      networkExposure: 0.8,
      recordsAtRisk: 5000,
    });
    expect(report.aleUsd).toBeGreaterThan(0);
    expect(report.riskTier).toBeTruthy();
    const prev = process.env.GUARDIAN_INSURANCE_REPORT_DIR;
    process.env.GUARDIAN_INSURANCE_REPORT_DIR = join(process.cwd(), 'reports', 'insurance-test');
    const pdf = writeInsuranceRiskPdf(report);
    expect(pdf.path).toMatch(/\.pdf$/);
    expect(pdf.pdfBase64.length).toBeGreaterThan(100);
    process.env.GUARDIAN_INSURANCE_REPORT_DIR = prev;
  });
});

describe('Phase 4 B3 federated learning', () => {
  it('is disabled by default', () => {
    const fl = new FederatedLearningCoordinator();
    expect(fl.isEnabled()).toBe(false);
    expect(fl.submitLocalDelta({ signatureHash: 'abc', sampleCount: 10 })).toBeNull();
  });

  it('submits deltas when enabled', () => {
    const prev = process.env.GUARDIAN_FEDERATED_LEARNING;
    process.env.GUARDIAN_FEDERATED_LEARNING = 'true';
    const fl = new FederatedLearningCoordinator();
    const delta = fl.submitLocalDelta({ signatureHash: 'abc', sampleCount: 10 });
    expect(delta).not.toBeNull();
    process.env.GUARDIAN_FEDERATED_LEARNING = prev;
  });

  it('aggregates deltas and runs ONNX inference when enabled', async () => {
    const prev = process.env.GUARDIAN_FEDERATED_LEARNING;
    process.env.GUARDIAN_FEDERATED_LEARNING = 'true';
    const fl = new FederatedLearningCoordinator();
    fl.submitLocalDelta({ signatureHash: 'a', sampleCount: 10 });
    fl.submitLocalDelta({ signatureHash: 'b', sampleCount: 10 });
    fl.submitLocalDelta({ signatureHash: 'c', sampleCount: 10 });
    const agg = fl.aggregateDeltas(3);
    expect(agg.aggregated).toBe(true);
    const infer = await fl.runOnnxInference([0.2, 0.3, 0.9]);
    expect(infer?.modelVersion).toBeTruthy();
    expect(infer?.label).toBeTruthy();
    expect(infer?.backend).toBeTruthy();
    process.env.GUARDIAN_FEDERATED_LEARNING = prev;
  });

  it('B3 privacy gate enforces minReports threshold', () => {
    const cfg = federatedPrivacyConfig();
    const blocked = shouldShareFederatedDelta({ sampleCount: 1, epsilon: cfg.epsilon, minReports: cfg.minReports });
    expect(blocked.share).toBe(false);
    const allowed = shouldShareFederatedDelta({ sampleCount: 10, epsilon: cfg.epsilon, minReports: cfg.minReports });
    expect(allowed.share).toBe(true);
  });
});

describe('C1 signed provenance export', () => {
  it('exports and verifies signed gzip bundle', () => {
    const chain = new ConfigProvenanceChain();
    const e1 = chain.append({ actor: 'test', eventType: 'policy_apply', resourcePath: '/tmp/p.yaml' });
    const bundle = exportSignedProvenanceBundle([e1], chain.getMerkleRoot());
    expect(bundle.eventCount).toBe(1);
    expect(bundle.bundleGzipBase64.length).toBeGreaterThan(10);
    expect(verifySignedProvenanceBundle(bundle)).toBe(true);
  });
});

describe('C5 policy approval store', () => {
  beforeEach(() => clearPolicyDraftsForTests());
  afterEach(() => clearPolicyDraftsForTests());

  it('tracks pending → approved → applied lifecycle', () => {
    const draft = storePolicyDraft({
      requestId: 'req-1',
      goal: 'block curl',
      rule: { name: 'deny-curl', action: 'block', tools: { deny: ['curl'] } },
      yaml: 'rules:\n  - name: deny-curl',
    });
    expect(draft.status).toBe('pending');
    expect(markPolicyDraftApproved('req-1')).toBe(true);
    expect(markPolicyDraftApplied('req-1')).toBe(true);
  });
});

describe('A1 SIEM export', () => {
  it('formats fleet chain alert as CEF', () => {
    const cef = fleetAlertToCef({
      alertId: 'a1',
      globalSessionId: 'sess-1',
      agents: ['agent-1'],
      servers: ['srv-a', 'srv-b'],
      tools: ['srv-a:read', 'srv-b:http'],
      pattern: 'read-then-exfil',
      mitreTechniques: ['T1048'],
      confidence: 0.82,
      description: 'Cross-server exfil chain',
    });
    const line = formatCefLine(cef);
    expect(line).toMatch(/^CEF:0\|MCP Guardian\|/);
    expect(line).toMatch(/read-then-exfil/);
  });

  it('exports SIEM bundle from fleet detector', () => {
    const detector = new FleetChainDetector();
    detector.record({ globalSessionId: 's1', agentId: 'a1', serverName: 'srv-a', toolName: 'read_file' });
    const bundle = detector.exportSiemBundle('s1');
    expect(bundle.format).toBe('json');
    expect(bundle.bundle.sessionId).toBe('s1');
  });
});

describe('SPIFFE identity', () => {
  it('reads SPIFFE ID from env', () => {
    const prev = process.env.GUARDIAN_SPIFFE_ID;
    process.env.GUARDIAN_SPIFFE_ID = 'spiffe://example.org/agent/test';
    expect(getActiveSpiffeId()).toBe('spiffe://example.org/agent/test');
    process.env.GUARDIAN_SPIFFE_ID = prev;
  });
});

describe('C3 dynamic tier adjustment', () => {
  it('downgrades to shadow on low composite score', () => {
    const enforcer = new SandboxTierEnforcer();
    enforcer.setTier({ scopeType: 'server', scopeId: 'filesystem' }, 'allow');
    const result = adjustSandboxTierForZeroTrust(enforcer, {
      serverName: 'filesystem',
      composite: 0.3,
      action: 'block',
    });
    expect(result.newTier).toBe('shadow');
    expect(result.adjusted).toBe(true);
  });
});

describe('C1 signed tarball export', () => {
  it('writes verifiable tar.gz bundle', () => {
    const chain = new ConfigProvenanceChain();
    const e1 = chain.append({ actor: 'test', eventType: 'policy_apply', resourcePath: '/tmp/p.yaml' });
    const out = join(process.cwd(), 'reports', 'provenance-test.tar.gz');
    const result = writeSignedProvenanceTarball([e1], chain.getMerkleRoot(), out);
    expect(result.tarballBytes).toBeGreaterThan(50);
    expect(verifySignedProvenanceBundle(result.bundle)).toBe(true);
  });
});

describe('A1 chain graph export', () => {
  it('builds nodes and edges for visualization', () => {
    const detector = new FleetChainDetector();
    detector.record({ globalSessionId: 's1', agentId: 'a1', serverName: 'srv-a', toolName: 'read_file' });
    const graph = detector.exportChainGraph('s1');
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
  });
});
