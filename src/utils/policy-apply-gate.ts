/**
 * Require policy simulation before applying YAML changes (autopilot / suggestions).
 */
import { simulatePolicyChange } from './policy-simulator.js';
import type { PolicyRule } from '../policy/policy-types.js';
import { Logger } from './logger.js';

export interface PolicyApplyGateResult {
  allowed: boolean;
  reason?: string;
  simulationSummary?: string;
}

export async function requirePolicySimulationBeforeApply(opts: {
  draftRule: PolicyRule;
  policyPath?: string;
  tenantId?: string;
  skip?: boolean;
}): Promise<PolicyApplyGateResult> {
  if (opts.skip || process.env.GUARDIAN_POLICY_SIM_GATE === 'false') {
    return { allowed: true };
  }

  try {
    const report = await simulatePolicyChange({
      draftRule: opts.draftRule,
      policyPath: opts.policyPath,
      tenantId: opts.tenantId,
      benchProfile: 'policy-apply-gate',
    });

    const fpRate = report.counterfactual.fpRiskScore ?? 0;
    const blockDelta =
      report.counterfactual.sampleCount > 0
        ? report.counterfactual.newBlocks / report.counterfactual.sampleCount
        : 0;
    const maxFp = parseFloat(process.env.GUARDIAN_POLICY_SIM_MAX_FP || '0.15');
    const maxBlockDelta = parseFloat(process.env.GUARDIAN_POLICY_SIM_MAX_BLOCK_DELTA || '0.25');

    if (fpRate > maxFp) {
      return {
        allowed: false,
        reason: `Simulation false-positive rate ${(fpRate * 100).toFixed(1)}% exceeds max ${(maxFp * 100).toFixed(0)}%`,
        simulationSummary: report.combinedSummary,
      };
    }
    if (Math.abs(blockDelta) > maxBlockDelta) {
      return {
        allowed: false,
        reason: `Simulation block-rate delta ${(blockDelta * 100).toFixed(1)}% exceeds max ${(maxBlockDelta * 100).toFixed(0)}%`,
        simulationSummary: report.combinedSummary,
      };
    }

    Logger.info(`[PolicyApplyGate] Simulation passed — applying rule "${opts.draftRule.name}"`);
    return { allowed: true, simulationSummary: report.combinedSummary };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (process.env.GUARDIAN_POLICY_SIM_FAIL_OPEN === 'true') {
      Logger.warn(`[PolicyApplyGate] Simulation failed (fail-open): ${msg}`);
      return { allowed: true, reason: msg };
    }
    return { allowed: false, reason: `Policy simulation failed: ${msg}` };
  }
}
