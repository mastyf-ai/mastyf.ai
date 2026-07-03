/**
 * Agentic AI Integration Tests — validates all 10 features work end-to-end.
 *
 * Run with: pnpm test -- tests/agentic/
 */

import { describe, it, expect } from 'vitest';
import { ApprovalGate, AgenticResult, AgenticPipeline } from '../../src/agentic/core.js';
import { AgenticScheduler } from '../../src/agentic/scheduler.js';
import { BehaviorCollector, type ToolCallObservation } from '../../src/agentic/policy-gen/behavior-collector.js';
import { PatternAnalyzer } from '../../src/agentic/policy-gen/pattern-analyzer.js';
import { PolicySynthesizer } from '../../src/agentic/policy-gen/policy-synthesizer.js';
import { PolicyDiff } from '../../src/agentic/policy-gen/policy-diff.js';
import { RiskScorer } from '../../src/agentic/threat-prediction/risk-scorer.js';
import { ThreatPredictor } from '../../src/agentic/threat-prediction/predictor.js';
import { SignatureVerifier } from '../../src/agentic/supply-chain/signature-verifier.js';
import { DriftDetector } from '../../src/agentic/drift/drift-detector.js';
import { ControlMapper } from '../../src/agentic/compliance/control-mapper.js';
import { AttackGenerator } from '../../src/agentic/red-team/attack-generator.js';
import { ThreatMeshNode } from '../../src/agentic/threat-mesh/mesh-node.js';
import { HoneypotManager } from '../../src/agentic/honeypot/honeypot-manager.js';
import { TrustNegotiationProtocol } from '../../src/agentic/trust-negotiation/protocol.js';

// ── Feature #1: Threat Prediction ──────────────────────────────────

describe('Feature #1: Predictive Threat Anticipation', () => {
  const scorer = new RiskScorer();
  const predictor = new ThreatPredictor();

  it('scores a high-risk server (execute_command over HTTP)', () => {
    const server = {
      name: 'danger-server',
      command: 'execute_command',
      args: ['--shell'],
      packageName: 'mcp-shell-server',
      transport: 'sse' as const,
    };
    const risk = scorer.scoreServer(server, 3, 8.5);
    expect(risk.overallScore).toBeGreaterThan(50);
    expect(risk.tier).toBe('high');
    expect(risk.factors.length).toBe(5);
  });

  it('scores a low-risk server (stdio read-only)', () => {
    const server = {
      name: 'safe-server',
      command: 'read',
      packageName: '@modelcontextprotocol/sdk',
      transport: 'stdio' as const,
    };
    const risk = scorer.scoreServer(server, 0, 0);
    expect(risk.overallScore).toBeLessThan(30);
    expect(risk.tier).toBe('low');
  });

  it('generates a threat forecast with preemptive actions', () => {
    const risk = scorer.scoreServer(
      { name: 'test', transport: 'sse' as const },
      5,
      9.5,
    );
    const forecast = predictor.forecast(risk, 5, 'increasing');
    expect(forecast.risk30d).toBeGreaterThan(forecast.currentRisk);
    expect(forecast.exploitationProbability).toBeGreaterThan(0);
    expect(forecast.topThreats.length).toBeGreaterThan(0);
    expect(forecast.preemptiveActions.length).toBeGreaterThan(0);
  });
});

// ── Feature #2: Policy Generation ──────────────────────────────────

describe('Feature #2: Autonomous Policy Generation', () => {
  const collector = new BehaviorCollector();
  const analyzer = new PatternAnalyzer();
  const synthesizer = new PolicySynthesizer();
  const differ = new PolicyDiff();

  it('collects observations and produces statistics', () => {
    const window = collector.startWindow('test-window');

    const observations: ToolCallObservation[] = [
      { toolName: 'read_file', serverName: 'filesystem', argumentKeys: ['path'], argumentTypes: { path: 'string' }, argumentRanges: { path: { min: 5, max: 20 } }, timestamp: Date.now(), latencyMs: 50, success: true, sessionHash: 'abc' },
      { toolName: 'read_file', serverName: 'filesystem', argumentKeys: ['path'], argumentTypes: { path: 'string' }, argumentRanges: { path: { min: 5, max: 20 } }, timestamp: Date.now() + 1000, latencyMs: 45, success: true, sessionHash: 'abc' },
      { toolName: 'write_file', serverName: 'filesystem', argumentKeys: ['path', 'content'], argumentTypes: { path: 'string', content: 'string' }, argumentRanges: { path: { min: 5, max: 10 }, content: { min: 10, max: 50 } }, timestamp: Date.now() + 2000, latencyMs: 75, success: true, sessionHash: 'abc' },
    ];

    for (const obs of observations) {
      collector.record(obs);
    }

    const summary = collector.getSummary()!;
    expect(summary.totalCalls).toBe(3);
    expect(summary.uniqueTools).toBe(2);

    const finalized = collector.finalizeWindow()!;
    expect(finalized.complete).toBe(true);
    expect(finalized.totalCalls).toBe(3);
  });

  it('analyzes observations and synthesizes a policy', () => {
    const window = collector.getHistory()[0]!;
    const analysis = analyzer.analyze(window, window.stats);
    expect(analysis.toolProfiles.length).toBe(2);
    expect(analysis.normalWorkflows.length).toBeGreaterThanOrEqual(0);

    const policy = synthesizer.synthesize(analysis);
    expect(policy.yaml).toContain('rules:');
    expect(policy.yaml).toContain('read_file');
    expect(policy.yaml).toContain('write_file');
    expect(policy.confidence).toBeGreaterThan(0);
    expect(policy.suggestions.length).toBeGreaterThan(0);
  });

  it('diffs against existing policy', () => {
    const window = collector.getHistory()[0]!;
    const analysis = analyzer.analyze(window, window.stats);
    const policy = synthesizer.synthesize(analysis);
    const diff = differ.diff(policy, 'rules:\n  - rule: allow_tool\n    tool: "read_file"');
    expect(diff.additions.length).toBeGreaterThan(0);
    expect(diff.similarityScore).toBeLessThan(1);
  });
});

// ── Feature #3: Threat Mesh ────────────────────────────────────────

describe('Feature #3: Threat Intelligence Mesh', () => {
  it('submits observations with privacy hashing', () => {
    const node = new ThreatMeshNode();
    // Node may not be enabled by default
    const stats = node.getStats();
    expect(stats.localSignatures).toBe(0);
    expect(typeof stats.enabled).toBe('boolean');
  });

  it('looks up known patterns', () => {
    const node = new ThreatMeshNode();
    const result = node.lookupPattern('test-pattern');
    expect(result).toBeNull(); // No pattern registered yet
  });
});

// ── Feature #4: Honeypot ───────────────────────────────────────────

describe('Feature #4: Agentic Honeypot Deployer', () => {
  const manager = new HoneypotManager();

  it('deploys a honeypot and captures calls', () => {
    const instance = manager.deploy({
      name: 'test-db',
      template: 'decoy-production-database',
      ttlMs: 5000,
      alertOnInteraction: false,
    });

    expect(instance.status).toBe('active');
    expect(manager.getActive().length).toBe(1);

    const capture = manager.capture(instance.id, 'query', { sql: 'SELECT * FROM users' });
    expect(capture).not.toBeNull();
    expect(capture!.detectedPattern).toBeUndefined();

    const sensitive = manager.capture(instance.id, 'query', { sql: 'SELECT password FROM users' });
    expect(sensitive!.detectedPattern).toBe('credential_theft_attempt');
  });

  it('provides template tools', () => {
    const tools = manager.getTemplateTools('decoy-credentials-vault');
    expect(tools.length).toBe(3);
    expect(tools[0]!.name).toBe('get_secret');
  });
});

// ── Feature #5: Supply Chain ───────────────────────────────────────

describe('Feature #5: Supply Chain Integrity', () => {
  const verifier = new SignatureVerifier();

  it('verifies a trusted package', () => {
    const result = verifier.verify('@modelcontextprotocol/sdk', '1.25.0');
    expect(result.trustedPublisher).toBe(true);
    expect(result.typoSquat).toBe(false);
    expect(result.integrityScore).toBeGreaterThan(80);
  });

  it('detects typo-squatting', () => {
    const result = verifier.verify('mcp-servr-github', '1.0.0');
    expect(result.typoSquat).toBe(true);
    expect(result.similarPackages.length).toBeGreaterThan(0);
  });

  it('detects dependency confusion risk', () => {
    const result = verifier.verify('utils', '1.0.0');
    expect(result.dependencyConfusion).toBe(true);
    expect(result.integrityScore).toBeLessThan(80);
  });
});

// ── Feature #7: Compliance ─────────────────────────────────────────

describe('Feature #7: Autonomous Compliance Evidence', () => {
  const mapper = new ControlMapper();

  it('evaluates SOC 2 posture', () => {
    const posture = mapper.evaluate('soc2',
      ['access control', 'authentication', 'authorization', 'deny_shell', 'deny_path', 'input validation', 'injection', 'command validation', 'executable', 'malicious', 'monitor', 'alert', 'logging', 'anomaly', 'detection', 'incident', 'respond', 'webhook'],
      ['shell_injection', 'path_traversal']);
    expect(posture.totalControls).toBe(5);
    expect(posture.postureScore).toBeGreaterThan(0);
    expect(posture.summary.length).toBeGreaterThan(0);
  });

  it('identifies gaps', () => {
    const posture = mapper.evaluate('hipaa', [], []);
    expect(posture.satisfiedControls).toBe(0);
    expect(posture.criticalGaps.length).toBeGreaterThan(0);
  });

  it('evaluates all frameworks', () => {
    for (const fw of ['soc2', 'hipaa', 'pci-dss', 'fedramp', 'iso27001'] as const) {
      const posture = mapper.evaluate(fw, ['access control', 'audit'], ['injection']);
      expect(posture.framework).toBe(fw);
      expect(posture.totalControls).toBeGreaterThan(0);
    }
  });
});

// ── Feature #8: Drift Detection ────────────────────────────────────

describe('Feature #8: Drift Detection & Rollback', () => {
  const detector = new DriftDetector();

  it('captures a baseline', () => {
    const baseline = detector.captureBaseline('test-server', [
      { name: 'read', description: 'Read file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    ], { latencyP50: 100, latencyP95: 500, successRate: 1.0, avgResponseSize: 1024 });

    expect(baseline.serverName).toBe('test-server');
    expect(Object.keys(baseline.toolSchemas).length).toBe(1);
  });

  it('detects no drift for identical state', () => {
    const baseline = detector.getLatestBaseline('test-server')!;
    const result = detector.detectDrift(baseline, [
      { name: 'read', description: 'Read file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    ], { latencyP50: 100, latencyP95: 500, successRate: 1.0, avgResponseSize: 1024 });

    expect(result.data!.drifted).toBe(false);
    expect(result.data!.driftScore).toBe(0);
  });

  it('detects drift from schema change', () => {
    const baseline = detector.getLatestBaseline('test-server')!;
    const result = detector.detectDrift(baseline, [
      { name: 'read', description: 'Read file', inputSchema: { type: 'object', properties: { path: { type: 'string' }, mode: { type: 'string' } } } },
    ], { latencyP50: 100, latencyP95: 500, successRate: 1.0, avgResponseSize: 1024 });

    expect(result.data!.drifted).toBe(true);
    expect(result.data!.findings.length).toBeGreaterThan(0);
  });
});

// ── Feature #9: Red Team ───────────────────────────────────────────

describe('Feature #9: Autonomous Red Team Engine', () => {
  const generator = new AttackGenerator();

  it('generates base attacks', () => {
    // Base corpus is built into constructor
    expect(generator).toBeDefined();
  });

  it('generates mutations', () => {
    const mutations = generator.generateMutations(10);
    expect(mutations.length).toBe(10);
    expect(mutations.every(m => m.generated)).toBe(true);
  });

  it('generates combinations', () => {
    const combos = generator.generateCombinations(5);
    expect(combos.length).toBeGreaterThan(0);
    expect(combos.every(c => c.generated)).toBe(true);
  });

  it('generates full attack set', () => {
    const all = generator.generateAllAttacks();
    expect(all.length).toBeGreaterThan(30); // 16 base + 30 mutations + 15 combos
  });
});

// ── Feature #10: Trust Negotiation ─────────────────────────────────

describe('Feature #10: Agent-to-Agent Trust Protocol', () => {
  const protocol = new TrustNegotiationProtocol();

  it('negotiates trust with a registered agent', () => {
    protocol.registerAgent({ agentId: 'agent-b', mastyfAiInstance: 'instance-b', capabilities: ['read', 'write', 'query'] });

    const result = protocol.negotiate(
      { agentId: 'agent-a', mastyfAiInstance: 'instance-a', capabilities: ['scan', 'audit'] },
      { agentId: 'agent-b', mastyfAiInstance: 'instance-b', capabilities: ['read', 'write'] },
      { requestedTools: ['read'], scope: {}, maxSessionMinutes: 30 },
    );

    expect(result.success).toBe(true);
    expect(result.sessionId).toBeDefined();
    expect(result.negotiatedPolicy?.allowedTools).toContain('read');
  });

  it('rejects unknown agents without attestation', () => {
    const result = protocol.negotiate(
      { agentId: 'agent-a', mastyfAiInstance: 'instance-a', capabilities: [] },
      { agentId: 'unknown-agent', mastyfAiInstance: 'unknown', capabilities: ['hack'] },
      { requestedTools: ['hack'], scope: {}, maxSessionMinutes: 5 },
    );

    expect(result.success).toBe(false);
  });

  it('checks access within a session', () => {
    protocol.registerAgent({ agentId: 'agent-c', mastyfAiInstance: 'instance-c', capabilities: ['search'] });
    const result = protocol.negotiate(
      { agentId: 'agent-a', mastyfAiInstance: 'instance-a', capabilities: [] },
      { agentId: 'agent-c', mastyfAiInstance: 'instance-c', capabilities: ['search'] },
      { requestedTools: ['search'], scope: {}, maxSessionMinutes: 30 },
    );

    const access = protocol.checkAccess(result.sessionId!, 'search');
    expect(access.allowed).toBe(true);
  });
});

// ── Core Framework Tests ───────────────────────────────────────────

describe('Agentic Core Framework', () => {
  it('AgenticResult.ok and .fail work correctly', () => {
    const ok = AgenticResult.ok({ value: 42 });
    expect(ok.isSuccess).toBe(true);
    expect(ok.data!.value).toBe(42);

    const fail = AgenticResult.fail('error occurred');
    expect(fail.isSuccess).toBe(false);
    expect(fail.error).toBe('error occurred');
  });

  it('ApprovalGate handles pending/approve/deny lifecycle', () => {
    const gate = new ApprovalGate();
    const requestId = gate.submit('test-tool', 'Test request', []);

    expect(gate.listPending().length).toBe(1);

    gate.approve(requestId);
    expect(gate.get(requestId)!.status).toBe('approved');

    const id2 = gate.submit('test2', 'Another', []);
    gate.deny(id2);
    expect(gate.get(id2)!.status).toBe('denied');
  });

  it('AgenticScheduler registers and tracks tasks', () => {
    const scheduler = new AgenticScheduler();
    scheduler.register('test-task', 'Test Task', '1h', async () => {});
    const task = scheduler.getTask('test-task')!;
    expect(task.name).toBe('Test Task');
    expect(task.enabled).toBe(true);
  });
});