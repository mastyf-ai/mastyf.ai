import { alertPolicyBlock } from './webhook-alerter.js';
/** Push policy-block alerts to webhooks and incident automation (all proxy transports). */
export function notifyToolBlock(opts) {
    const { serverName, toolName, rule, reason, anomalyScore = 0.95 } = opts;
    const requestId = opts.requestId != null ? String(opts.requestId) : undefined;
    void alertPolicyBlock(serverName, toolName, rule, reason, requestId);
    void import('./incident-responder.js').then(({ checkAndRespondToCriticalBlock, trackBlockSpike }) => {
        trackBlockSpike(true);
        return checkAndRespondToCriticalBlock(reason, anomalyScore, toolName, serverName);
    }).catch(() => undefined);
}
//# sourceMappingURL=notify-tool-block.js.map