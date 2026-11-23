/**
 * Shared tool-response inspection logic for all proxy transports
 * (HTTP, SSE, WebSocket). Centralises response gating, DLP, logging,
 * metrics, redaction-meta injection, and block-response generation.
 */
import { findingsToMessages, isResponseScanSkipped } from '../utils/streaming-inspector.js';
import { clipMatch } from './block-evidence.js';
import { gateToolResponseText } from '../utils/response-security-gate.js';
import { injectRedactionMeta } from '../utils/redaction-meta.js';
import { Logger } from '../utils/logger.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import * as Metrics from '../utils/metrics.js';
import { observeToolResult, recordToolOutput } from '../extensions/index.js';
/**
 * Inspect a JSON-RPC tool-call response for policy violations, DLP
 * matches, and semantic threats.
 *
 * When the response is redacted the function **mutates** `response.result`
 * in place (all three transports rely on this behaviour).
 */
export async function inspectToolResponse(params) {
    const { response, toolName, serverName, requestId, tenantId, policyEngine, transportLabel } = params;
    const result = response.result;
    // Before anything can return: a redacted reply still reaches the agent, and so does a skipped scan.
    if (result != null)
        observeToolResult({ tenantId, sessionId: params.sessionId, serverName, toolName, result });
    if (result == null || isResponseScanSkipped()) {
        return { blocked: false, redacted: false };
    }
    const responseText = JSON.stringify(result);
    // Scan tool result for prompt-injection / instruction-override payloads
    try {
        const { scanToolResult } = await import('../scanners/result-injection-scanner.js');
        const scan = scanToolResult(result);
        if (scan.injected && scan.confidence >= 0.85) {
            Logger.warn(`[${transportLabel}:${serverName}] Blocked prompt injection in tool result from '${toolName}': ${scan.threatCategory ?? 'injection'}`);
            StructuredLogger.logBlocked({
                event: 'tool_blocked',
                serverName,
                toolName,
                reason: `Prompt injection detected in tool result (${scan.threatCategory})`,
                rule: 'result-prompt-injection',
                requestId: String(requestId),
            });
            const matched = clipMatch(scan.matchedText);
            return {
                blocked: true,
                redacted: false,
                evidence: { layer: 'answer-check', ...(matched ? { match: matched } : {}), confidence: scan.confidence },
                blockResponse: {
                    jsonrpc: '2.0',
                    id: requestId,
                    error: {
                        code: -32002,
                        message: `Blocked by Mastyf AI: Prompt injection detected in tool result (${scan.threatCategory})`,
                    },
                },
            };
        }
    }
    catch (err) {
        Logger.debug(`[${transportLabel}] result-injection scanner error: ${String(err)}`);
    }
    // Vuln Discovery: record unpublished/injection findings from tool results
    if (process.env.MASTYF_AI_VULN_DISCOVERY_ENABLED === 'true') {
        try {
            const { scanToolResponse } = await import('../vuln-discovery/response-scanner.js');
            const vulnScan = scanToolResponse({
                serverName,
                toolName,
                result,
                createFindings: true,
            });
            if (vulnScan.shouldBlock) {
                return {
                    blocked: true,
                    redacted: false,
                    blockResponse: {
                        jsonrpc: '2.0',
                        id: requestId,
                        error: {
                            code: -32002,
                            message: `Blocked by Mastyf AI vuln response scanner: ${vulnScan.hits.map((h) => h.patternId).join(', ')}`,
                        },
                    },
                };
            }
        }
        catch (err) {
            Logger.debug(`[${transportLabel}] vuln response scan skipped: ${err instanceof Error ? err.message : String(err)}`);
        }
        // Live traffic tap: malicious args + proven exploit effect on allowed calls
        try {
            const { tapAllowedToolCall } = await import('../vuln-discovery/live-traffic-tap.js');
            tapAllowedToolCall({
                serverName,
                toolName,
                args: params.toolArguments,
                result,
                blockedByProxy: false,
                tenantId,
            });
        }
        catch (err) {
            Logger.debug(`[${transportLabel}] live traffic tap skipped: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    const gate = await gateToolResponseText({
        responseText,
        toolName,
        serverName,
        policy: policyEngine,
        requestId,
        tenantId,
    });
    const inspect = gate.inspect;
    // --- Log & record metrics when findings are present ----------------------
    if (inspect && !inspect.clean) {
        const allMessages = findingsToMessages(inspect.findings);
        Logger.warn(`[${transportLabel}:${serverName}] Suspicious response from '${toolName}': ${allMessages.slice(0, 5).join('; ')}`);
        StructuredLogger.info({
            event: 'response_flagged',
            serverName,
            toolName,
            detections: allMessages,
            blocked: gate.outcome.action === 'block',
        });
        Metrics.injectionDetectedTotal?.inc({
            server_name: serverName,
            severity: inspect.hasCritical ? 'critical' : 'high',
        });
    }
    // --- Handle redaction ----------------------------------------------------
    if (gate.outcome.action === 'redact' && gate.outcome.body) {
        let parsed;
        try {
            parsed = JSON.parse(gate.outcome.body);
        }
        catch {
            // The redacted text isn't valid any more. Forwarding the original would pass on the very secret
            // that was found, so the result is blocked instead.
            return {
                blocked: true,
                redacted: false,
                evidence: { layer: 'answer-check' },
                blockResponse: {
                    jsonrpc: '2.0',
                    id: requestId,
                    error: {
                        code: -32002,
                        message: 'Blocked by Mastyf AI: sensitive data in tool result could not be redacted safely',
                        data: { rule: 'response-redaction-failed' },
                    },
                },
            };
        }
        response.result = injectRedactionMeta(parsed, gate.outcome.redactionReasons);
        return { blocked: false, redacted: true, redactionReasons: gate.outcome.redactionReasons };
    }
    // --- Handle block --------------------------------------------------------
    if (gate.outcome.action === 'block') {
        return {
            blocked: true,
            redacted: false,
            blockResponse: {
                jsonrpc: '2.0',
                id: requestId,
                error: {
                    code: -32002,
                    message: gate.outcome.message,
                },
            },
        };
    }
    recordToolOutput({ sessionKey: `${tenantId || 'default'}:${serverName}`, toolName, output: result });
    return { blocked: false, redacted: false };
}
//# sourceMappingURL=response-inspection.js.map