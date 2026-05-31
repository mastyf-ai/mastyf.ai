/**
 * Policy simulator — combines counterfactual replay, policy diff, and harness sample.
 */
import { readFileSync, existsSync } from 'fs';
import { PolicyDiff } from '../agentic/policy-gen/policy-diff.js';
import type { SynthesizedPolicy } from '../agentic/policy-gen/policy-synthesizer.js';
import { simulatePolicyCounterfactual, type CounterfactualReport } from '../ai/policy-counterfactual.js';
import { runGuardianBenchScorecard, type BenchmarkScorecard } from './guardian-bench.js';
import type { PolicyRule } from '../policy/policy-types.js';

function stubPolicy(yaml: string): SynthesizedPolicy {
  return {
    yaml,
    confidence: 0.7,
    summary: 'Simulated policy',
    suggestions: [],
    rationale: {},
    metadata: {
      generatedAt: new Date().toISOString(),
      generatorVersion: 'policy-simulator',
      observationWindowId: 'sim',
      totalToolsObserved: 0,
      toolsInPolicy: 0,
      toolsWithRateLimits: 0,
      toolsWithSemanticGuard: 0,
      securityRulesGenerated: 0,
    },
  };
}

export interface PolicySimulationReport {
  generatedAt: string;
  counterfactual: CounterfactualReport;
  harnessSample: BenchmarkScorecard;
  policyDiffSummary?: string;
  combinedSummary: string;
}

export async function simulatePolicyChange(opts: {
  draftRule?: PolicyRule;
  policyPath?: string;
  existingPolicyYaml?: string;
  generatedPolicyYaml?: string;
  tenantId?: string;
  windowDays?: number;
  benchProfile?: string;
}): Promise<PolicySimulationReport> {
  const counterfactual = await simulatePolicyCounterfactual({
    draftRule: opts.draftRule,
    policyPath: opts.policyPath,
    tenantId: opts.tenantId,
    windowDays: opts.windowDays,
  });

  const harnessSample = runGuardianBenchScorecard(undefined, opts.benchProfile ?? 'policy-sim');

  let policyDiffSummary: string | undefined;
  if (opts.generatedPolicyYaml && opts.existingPolicyYaml) {
    const differ = new PolicyDiff();
    const diff = differ.diff(stubPolicy(opts.generatedPolicyYaml), opts.existingPolicyYaml);
    policyDiffSummary = diff.summary;
  } else if (opts.policyPath && existsSync(opts.policyPath) && opts.generatedPolicyYaml) {
    const existing = readFileSync(opts.policyPath, 'utf-8');
    const differ = new PolicyDiff();
    policyDiffSummary = differ.diff(stubPolicy(opts.generatedPolicyYaml), existing).summary;
  }

  const combinedSummary = [
    counterfactual.summary,
    harnessSample.summary,
    policyDiffSummary ? `Policy diff: ${policyDiffSummary}` : undefined,
  ].filter(Boolean).join(' | ');

  return {
    generatedAt: new Date().toISOString(),
    counterfactual,
    harnessSample,
    policyDiffSummary,
    combinedSummary,
  };
}

export type { BenchmarkScorecard } from './guardian-bench.js';
export type { CounterfactualReport } from '../ai/policy-counterfactual.js';
