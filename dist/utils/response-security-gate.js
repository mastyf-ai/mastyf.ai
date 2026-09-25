/**
 * Unified response security gate: DLP + optional sync semantic block/redact.
 */
import { findingsToMessages, inspectFullResponse, isResponseScanSkipped, shouldBlockResponseDlp, } from './streaming-inspector.js';
import { getResponseDlpMode } from '../policy/response-dlp.js';
import { evaluateSyncSemanticResponse, isSyncSemanticResponseEnabled, } from '../ai/sync-semantic-response.js';
import { scanToolCallArguments } from '../scanners/prompt-injection-detector.js';
function scanResponseForPromptInjection(responseText) {
    if (!responseText || responseText.length < 8)
        return null;
    const findings = scanToolCallArguments({ content: responseText });
    if (findings.length > 0) {
        const f = findings[0];
        return `${f.description} (${f.patternId})`;
    }
    return null;
}
export async function gateToolResponseText(opts) {
    if (isResponseScanSkipped()) {
        return { outcome: { action: 'forward' }, inspect: null };
    }
    const inspect = inspectFullResponse(opts.responseText, {
        toolName: opts.toolName,
        serverName: opts.serverName,
        policy: opts.policy ?? undefined,
    });
    const policyMode = opts.policy?.getMode() ?? 'audit';
    if (inspect.redactedBody && inspect.dlpMode === 'redact') {
        return {
            outcome: {
                action: 'redact',
                body: inspect.redactedBody,
                redactionReasons: inspect.redactionReasons,
            },
            inspect,
        };
    }
    const blockDlp = shouldBlockResponseDlp({
        clean: inspect.clean,
        findings: [],
        hasCritical: inspect.hasCritical,
        hasHigh: inspect.hasHigh,
        truncated: !!inspect.truncated,
        scannedBytes: 0,
        mode: inspect.dlpMode || getResponseDlpMode(),
        redactedBody: inspect.redactedBody,
    });
    if (blockDlp && policyMode === 'block') {
        const summary = findingsToMessages(inspect.findings).slice(0, 3).join('; ');
        return {
            outcome: {
                action: 'block',
                message: `Mastyf AI: Tool response blocked by output DLP — ${summary || 'sensitive data in response'}`,
                rule: 'response-dlp',
            },
            inspect,
        };
    }
    const piBlockReason = scanResponseForPromptInjection(opts.responseText);
    if (piBlockReason && policyMode === 'block') {
        return {
            outcome: {
                action: 'block',
                message: `Mastyf AI: Tool response blocked — prompt injection in tool result (${piBlockReason})`,
                rule: 'result-prompt-injection',
            },
            inspect,
        };
    }
    if (isSyncSemanticResponseEnabled(opts.tenantId)) {
        const sem = await evaluateSyncSemanticResponse({
            serverName: opts.serverName,
            toolName: opts.toolName,
            responseText: opts.responseText,
            requestId: opts.requestId,
            tenantId: opts.tenantId,
        });
        if (sem.block && policyMode === 'block') {
            return {
                outcome: {
                    action: 'block',
                    message: `Mastyf AI: Tool response blocked by semantic review — ${sem.result.reasoning || sem.result.categories.join(', ')}`,
                    rule: 'sync-semantic-response',
                },
                inspect,
            };
        }
    }
    if (!inspect.clean && (inspect.hasCritical || inspect.hasHigh) && policyMode === 'block') {
        const summary = findingsToMessages(inspect.findings).slice(0, 3).join('; ');
        return {
            outcome: {
                action: 'block',
                message: `Mastyf AI: Tool response blocked — ${summary || 'policy violation in response'}`,
                rule: 'response-inspection',
            },
            inspect,
        };
    }
    return { outcome: { action: 'forward' }, inspect };
}
//# sourceMappingURL=response-security-gate.js.map