import { evaluateSessionFlowGuard, evaluateLoopAnomalyGuard, recordSessionToolCall, } from '../session-flow-guard.js';
import { evaluateSessionChainGuard, } from '../session-chain-detector.js';
import * as Metrics from '../../utils/metrics.js';
/** Multi-call read-then-exfil sequencing and cross-tool chain detection. */
export const sessionFlowStrategy = {
    name: 'session-flow',
    evaluate({ normalized }, deps) {
        const loop = evaluateLoopAnomalyGuard(normalized);
        if (loop) {
            Metrics.loopBlocksTotal.inc(Metrics.withTenantMetricLabels({ rule: loop.rule || 'loop-anomaly-perturbation' }, normalized.tenantId));
            recordSessionToolCall(normalized);
            return { ...loop, action: deps.resolveAction(loop.action) };
        }
        const chainDetect = evaluateSessionChainGuard(normalized);
        if (chainDetect) {
            recordSessionToolCall(normalized);
            return { ...chainDetect, action: deps.resolveAction(chainDetect.action) };
        }
        const chain = evaluateSessionFlowGuard(normalized);
        if (chain) {
            recordSessionToolCall(normalized);
            return { ...chain, action: deps.resolveAction(chain.action) };
        }
        recordSessionToolCall(normalized);
        return null;
    },
};
//# sourceMappingURL=session-flow-strategy.js.map