/**
 * A2 — Isolated replay harness: red-team corpus + legitimate traffic against sandbox tier.
 */
import { PolicyEngine } from '../../policy/policy-engine.js';
import type { CallContext, PolicyRule } from '../../policy/policy-types.js';
import { loadCorpusSamples } from '../../ai/threat-lab.js';
import { Logger } from '../../utils/logger.js';
import type { IndustryStandardStore } from '../../database/industry-standard-store.js';

export interface ReplayHarnessResult {
  serverName: string;
  attacksTotal: number;
  attacksBlocked: number;
  workflowsTotal: number;
  workflowsPreserved: number;
  capturedReplayed: number;
  capturedPassRate?: number;
  sampleResults: Array<{ id: string; toolName: string; expected: string; actual: string; ok: boolean }>;
}

function evalCall(engine: PolicyEngine, ctx: CallContext): 'block' | 'flag' | 'pass' {
  const result = engine.evaluate(ctx);
  if (result.action === 'block') return 'block';
  if (result.action === 'flag') return 'flag';
  return 'pass';
}

/** Replay adversarial corpus + captured twin traffic against a draft rule. */
export async function runDigitalTwinReplayHarness(params: {
  serverName: string;
  draftRule?: PolicyRule;
  policyPath?: string;
  maxSamples?: number;
  useCapturedTraffic?: boolean;
  /** When true, replay only live-captured twin traffic (skip adversarial corpus). */
  capturedTrafficOnly?: boolean;
  store?: IndustryStandardStore;
}): Promise<ReplayHarnessResult> {
  const { parsePolicyConfig } = await import('../../policy/policy-schema.js');
  const { load } = await import('js-yaml');
  const { readFileSync, existsSync } = await import('fs');
  const policyPath = params.policyPath ?? process.env.GUARDIAN_POLICY_PATH ?? 'default-policy.yaml';
  if (!existsSync(policyPath)) {
    return {
      serverName: params.serverName,
      attacksTotal: 0,
      attacksBlocked: 0,
      workflowsTotal: 0,
      workflowsPreserved: 0,
      capturedReplayed: 0,
      sampleResults: [],
    };
  }

  const raw = load(readFileSync(policyPath, 'utf-8')) as import('../../policy/policy-types.js').PolicyConfig;
  const config = parsePolicyConfig(raw);
  if (params.draftRule) {
    config.policy.rules.push(params.draftRule);
  }
  const engine = new PolicyEngine(config);

  const corpus = loadCorpusSamples().slice(0, params.maxSamples ?? 200);
  const sampleResults: ReplayHarnessResult['sampleResults'] = [];
  let attacksBlocked = 0;
  let attacksTotal = 0;
  let workflowsPreserved = 0;
  let workflowsTotal = 0;
  let capturedReplayed = 0;
  let capturedPassed = 0;

  const skipCorpus = params.capturedTrafficOnly === true;

  if (params.useCapturedTraffic !== false && params.store?.listDigitalTwinObservations) {
    const captured = params.store.listDigitalTwinObservations(params.serverName, params.maxSamples ?? 200);
    for (const obs of captured) {
      capturedReplayed++;
      const ctx: CallContext = {
        serverName: params.serverName,
        toolName: obs.toolName,
        arguments: obs.argsJson ?? {},
        requestId: `twin-${obs.recordedAt}`,
        requestTokens: 0,
        timestamp: obs.recordedAt,
      };
      const actual = evalCall(engine, ctx);
      workflowsTotal++;
      if (actual !== 'block') {
        workflowsPreserved++;
        capturedPassed++;
      }
      sampleResults.push({
        id: `captured-${capturedReplayed}`,
        toolName: obs.toolName,
        expected: 'pass',
        actual,
        ok: actual !== 'block',
      });
    }
  }

  if (!skipCorpus) {
  for (const sample of corpus) {
    const ctx: CallContext = {
      serverName: params.serverName,
      toolName: sample.toolName,
      arguments: sample.arguments ?? {},
      requestId: `replay-${sample.id}`,
      requestTokens: 0,
      timestamp: new Date().toISOString(),
    };
    const actual = evalCall(engine, ctx);
    const expectedBlock = sample.expected === 'block';
    if (expectedBlock) {
      attacksTotal++;
      if (actual === 'block') attacksBlocked++;
    } else {
      workflowsTotal++;
      if (actual !== 'block') workflowsPreserved++;
    }
    sampleResults.push({
      id: sample.id,
      toolName: sample.toolName,
      expected: sample.expected,
      actual,
      ok: expectedBlock ? actual === 'block' : actual !== 'block',
    });
  }
  }

  Logger.info(
    `[DigitalTwinReplay] ${params.serverName}: blocked ${attacksBlocked}/${attacksTotal} attacks, preserved ${workflowsPreserved}/${workflowsTotal} workflows, replayed ${capturedReplayed} captured calls${skipCorpus ? ' (captured-only)' : ''}`,
  );

  return {
    serverName: params.serverName,
    attacksTotal,
    attacksBlocked,
    workflowsTotal,
    workflowsPreserved,
    capturedReplayed,
    capturedPassRate: capturedReplayed > 0 ? (capturedPassed / capturedReplayed) * 100 : undefined,
    sampleResults: sampleResults.slice(0, 50),
  };
}
