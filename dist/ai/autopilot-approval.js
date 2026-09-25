import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { evaluateAutopilotSafety } from './autopilot-safety-contract.js';
import { scorePolicyImpact } from './policy-impact-scoring.js';
const ROLLBACK_LEDGER = join(process.cwd(), 'reports', 'autopilot', 'rollback-ledger.jsonl');
export function buildApprovalPreview(input) {
    const proposal = {
        suggestionId: input.suggestionId,
        rule: input.rule,
        source: input.source,
        stage: input.stage,
        evidence: {
            simulationPassed: input.evidence.simulationPassed,
            replayCoverage: input.evidence.replayCoverage,
            confidence: input.evidence.confidence,
            predictedFalsePositiveDelta: input.evidence.predictedFalsePositiveDelta,
            predictedBypassDelta: input.evidence.predictedBypassDelta,
            blastRadiusPercent: input.evidence.blastRadiusPercent,
            rollbackConfidence: input.evidence.rollbackConfidence,
            canarySizePercent: input.evidence.canarySizePercent,
        },
    };
    return {
        suggestionId: input.suggestionId,
        ruleName: input.rule.name,
        actor: input.actor,
        safety: evaluateAutopilotSafety(proposal),
        impact: scorePolicyImpact(input.evidence),
    };
}
export function appendRollbackLedger(entry) {
    mkdirSync(dirname(ROLLBACK_LEDGER), { recursive: true });
    const row = { timestamp: new Date().toISOString(), ...entry };
    appendFileSync(ROLLBACK_LEDGER, JSON.stringify(row) + '\n', 'utf-8');
}
export function readRollbackLedger(limit = 50) {
    if (!existsSync(ROLLBACK_LEDGER))
        return [];
    const lines = readFileSync(ROLLBACK_LEDGER, 'utf-8').split('\n').filter(Boolean);
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
        try {
            out.push(JSON.parse(lines[i]));
        }
        catch {
            // ignore malformed rows
        }
    }
    return out;
}
//# sourceMappingURL=autopilot-approval.js.map