/**
 * Proxy Integration Hooks — wire agentic features into the proxy pipeline.
 *
 * Import and call these functions from proxy-server.ts at `tools/call` time
 * to enable behavior observation and prompt injection detection.
 *
 * Usage in proxy-server.ts (add after policy evaluation, before forwarding):
 *
 *   import { hookAgenticObservation, hookPromptInjectionCheck } from '../agentic/proxy-integration.js';
 *   await hookAgenticObservation(container, serverName, toolName, args, sessionKey, latencyMs, success);
 *   await hookPromptInjectionCheck(container, serverName, toolName, args);
 */

import type { Container } from '../container.js';
import { createHash } from 'crypto';
import { Logger } from '../utils/logger.js';
import {
  fleetChainBlockConfidenceThreshold,
  resolveGlobalSessionId,
  isEphemeralRequestSession,
  deriveAgentIdForFleetChain,
  type GlobalSessionInput,
} from '../utils/global-session-id.js';

export type AgenticToolCallContext = GlobalSessionInput;

function resolveSessionContext(
  ctx: AgenticToolCallContext | string,
  legacyAgentId?: string,
): { globalSessionId: string; agentId?: string; requestId: string } {
  if (typeof ctx === 'string') {
    const requestId = ctx;
    const agentId = legacyAgentId;
    return {
      requestId,
      agentId,
      globalSessionId: resolveGlobalSessionId({ requestId, agentId }),
    };
  }
  return {
    requestId: ctx.requestId,
    agentId: ctx.agentId,
    globalSessionId: resolveGlobalSessionId(ctx),
  };
}

/**
 * Hook: Record a tool call observation for policy generation.
 * Call this on every tools/call that passes through the proxy.
 */
export async function hookAgenticObservation(
  container: Container,
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  sessionHash: string,
  _latencyMs: number,
  _success: boolean,
  agentId?: string,
  credentialIdentity?: string,
): Promise<void> {
  if (!container.behaviorCollector.isActive()) return;

  try {
    const argKeys = Object.keys(args);
    const argTypes: Record<string, string> = {};
    const argRanges: Record<string, { min?: number; max?: number; avg?: number }> = {};

    for (const key of argKeys) {
      const val = args[key];
      argTypes[key] = typeof val === 'string' ? 'string'
        : typeof val === 'number' ? 'number'
        : typeof val === 'boolean' ? 'boolean'
        : Array.isArray(val) ? 'array'
        : typeof val === 'object' && val !== null ? 'object'
        : 'unknown';

      if (typeof val === 'string') {
        argRanges[key] = { min: val.length, max: val.length, avg: val.length };
      } else if (typeof val === 'number') {
        argRanges[key] = { min: val, max: val, avg: val };
      }
    }

    container.behaviorCollector.record({
      toolName,
      serverName,
      argumentKeys: argKeys,
      argumentTypes: argTypes,
      argumentRanges: argRanges,
      timestamp: Date.now(),
      latencyMs: _latencyMs,
      success: _success,
      sessionHash,
      agentId: agentId ?? credentialIdentity,
      credentialIdentity: credentialIdentity ?? agentId,
    });
  } catch (err: unknown) {
    Logger.debug(`[AgenticProxyIntegration] Observation hook error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Hook: Run prompt injection detection on tool call arguments.
 * Call this before forwarding the tool call to the downstream server.
 *
 * Returns sanitized arguments if injection was detected and sanitization was applied.
 */
export async function hookPromptInjectionCheck(
  container: Container,
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ blocked: boolean; sanitizedArgs?: Record<string, unknown>; reason?: string }> {
  try {
    const result = await container.promptInjectionDetector.scan(toolName, serverName, args);
    const data = result.data!;

    const requestId = String(args.requestId ?? toolName);
    if (container.federatedLearning?.shouldRouteToFederatedModel(requestId)) {
      const features = [
        JSON.stringify(args).length / 10_000,
        data.confidence,
        /https?:\/\//.test(JSON.stringify(args)) ? 0.8 : 0.1,
      ];
      const fl = await container.federatedLearning!.runOnnxInference(features);
      if (fl && fl.label === 'injection' && fl.score >= 0.55) {
        container.federatedLearning!.recordBlockedSignature(`${toolName}:fl-onnx:${fl.modelVersion}`, features);
        return {
          blocked: true,
          reason: `Federated model blocked (${fl.modelVersion}, ${(fl.score * 100).toFixed(0)}%): ${fl.label}`,
        };
      }
    }

    if (data.detected) {
      // Record the decision in telemetry
      container.telemetry.recordDecision(
        'proxy-pipeline',
        'prompt-injection',
        {
          decisionId: crypto.randomUUID(),
          source: 'prompt-injection-detector',
          rationale: data.explanation,
          confidence: data.confidence,
          requiresApproval: data.confidence > 0.5 && data.confidence < 0.9,
          suggestedAction: data.confidence > 0.7 ? 'BLOCK' : 'WARN',
          timestamp: new Date().toISOString(),
          metadata: { toolName, serverName, category: data.category },
        },
        data.confidence > 0.7 ? 'auto_applied' : 'pending',
      );

      // If high confidence (>0.7), block and sanitize
      if (data.confidence > 0.7) {
        const sanitized = container.argumentSanitizer.sanitize(args, data);
        container.federatedLearning?.recordBlockedSignature(
          `${toolName}:${data.category ?? 'injection'}`,
        );
        return {
          blocked: true,
          sanitizedArgs: sanitized.args,
          reason: `PROMPT_INJECTION: ${data.explanation} (confidence: ${(data.confidence * 100).toFixed(0)}%)`,
        };
      }

      // Medium confidence (0.5-0.7): warn but allow through with sanitization
      if (data.confidence > 0.5) {
        const sanitized = container.argumentSanitizer.sanitize(args, data);
        Logger.warn(`[AgenticProxyIntegration] Prompt injection WARNING: ${data.explanation}`);
        return {
          blocked: false,
          sanitizedArgs: sanitized.args,
          reason: `WARNING: ${data.explanation}`,
        };
      }
    }

    return { blocked: false };
  } catch (err: unknown) {
    Logger.debug(`[AgenticProxyIntegration] Prompt injection hook error: ${err instanceof Error ? err.message : String(err)}`);
    return { blocked: false };
  }
}

/**
 * Hook: Submit blocked attack patterns to the threat intelligence mesh.
 * Call this when a policy rule blocks a tool call.
 */
export function hookThreatMeshContribution(
  container: Container,
  blockedPattern: string,
  category: string,
  severity: 'critical' | 'high' | 'medium' | 'low' = 'high',
): void {
  try {
    container.threatMeshNode.submitObservation(blockedPattern, category, severity);
  } catch (err: unknown) {
    Logger.debug(`[AgenticProxyIntegration] Threat mesh hook error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface AgenticAuditParams {
  sessionId: string;
  method: string;
  toolName?: string;
  args?: Record<string, unknown>;
  latencyMs: number;
  blocked: boolean;
  blockReason?: string;
  responseSize?: number;
  statusCode?: string;
  userId?: string;
}

/** Record an MCP request in the agentic audit trail. */
export function recordAgenticAudit(container: Container, params: AgenticAuditParams): void {
  try {
    container.requestAuditor.record({
      sessionId: params.sessionId,
      method: params.method,
      toolName: params.toolName,
      args: params.args,
      latencyMs: params.latencyMs,
      blocked: params.blocked,
      blockReason: params.blockReason,
      responseSize: params.responseSize ?? 0,
      statusCode: params.statusCode ?? (params.blocked ? 'blocked' : 'ok'),
      userId: params.userId,
    });
  } catch (err: unknown) {
    Logger.debug(
      `[AgenticProxyIntegration] Audit record error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Pre-forward hooks: sandbox tier, intent binding, collusion, reputation, injection scan. */
export async function runAgenticPreForwardHooks(
  container: Container,
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  sessionCtx: AgenticToolCallContext | string,
  legacyAgentId?: string,
): Promise<{ blocked: boolean; sanitizedArgs?: Record<string, unknown>; reason?: string }> {
  const { globalSessionId, agentId } = resolveSessionContext(sessionCtx, legacyAgentId);

  if (container.incidentPlaybook.isAgentIsolated(agentId ?? globalSessionId)) {
    return { blocked: true, reason: 'Agent session isolated by incident playbook' };
  }

  const cert = container.certifier.getCertification(serverName);
  container.sandboxEnforcer.ensureDefaultTierForServer(serverName, Boolean(cert?.certified));

  if (agentId) {
    const argBytes = JSON.stringify(args).length;
    container.reputationEngine.record(agentId, toolName, false, argBytes);
    container.behaviorFingerprint.observe({
      agentId,
      toolName,
      argBytes,
      timestamp: Date.now(),
      credentialIdentity: agentId,
    });
    const bioAnomaly = container.behaviorFingerprint.scoreAnomaly(agentId, {
      agentId,
      toolName,
      argBytes,
      timestamp: Date.now(),
      credentialIdentity: agentId,
    });
    if (bioAnomaly.blocked) {
      container.reputationEngine.recordBiometricSignal(agentId, bioAnomaly.score, bioAnomaly.reason.includes('credential'));
      return {
        blocked: true,
        reason: `Behavioral biometrics blocked (${(bioAnomaly.score * 100).toFixed(0)}%): ${bioAnomaly.reason}`,
      };
    }
    const repPolicy = container.reputationEngine.getPolicyForAgent(agentId);
    if (repPolicy.mode === 'strict' && /exec|shell|write|delete|run/i.test(toolName)) {
      return { blocked: true, reason: `Agent reputation tier strict: blocked sensitive tool ${toolName}` };
    }
  }

  const tierScope = { scopeType: 'server' as const, scopeId: serverName };
  const tier = container.sandboxEnforcer.getTier(tierScope);
  if (container.sandboxEnforcer.shouldShadow(tierScope)) {
    Logger.info(`[Sandbox] Shadow mode block: ${toolName} on ${serverName} (tier=${tier})`);
    return { blocked: true, reason: `Sandbox shadow tier: ${toolName} logged but not forwarded` };
  } else if (container.sandboxEnforcer.shouldRedact(tierScope)) {
    const redacted = { ...args };
    for (const k of Object.keys(redacted)) {
      if (/password|secret|token|key/i.test(k)) redacted[k] = '[REDACTED]';
    }
    args = redacted;
  }

  const intentCheck = container.intentEngine.isCallAllowed(globalSessionId, toolName);
  if (!intentCheck.allowed) {
    return { blocked: true, reason: intentCheck.reason ?? 'Intent binding violation' };
  }

  container.capabilityGraph.recordObservedCall(serverName, toolName, toolName, { argsKeys: Object.keys(args) });

  const collusion = container.collusionDetector.record(
    agentId ?? globalSessionId,
    serverName,
    toolName,
    { sessionId: globalSessionId },
  );
  if (collusion && collusion.confidence >= 0.65) {
    return { blocked: true, reason: collusion.description };
  }

  if (!isEphemeralRequestSession(globalSessionId)) {
    const fleetAgentId = deriveAgentIdForFleetChain(globalSessionId, agentId);
    const chainAlert = container.fleetChainDetector.record({
      globalSessionId,
      agentId: fleetAgentId,
      serverName,
      toolName,
      arguments: args,
    });
    const blockThreshold = fleetChainBlockConfidenceThreshold();
    if (chainAlert && chainAlert.confidence >= blockThreshold) {
      return {
        blocked: true,
        reason: `Cross-MCP attack chain blocked (${chainAlert.pattern}, ${(chainAlert.confidence * 100).toFixed(0)}%): ${chainAlert.description}`,
      };
    }
  }

  const injection = await hookPromptInjectionCheck(container, serverName, toolName, args);
  if (injection.blocked) {
    return injection;
  }
  await hookAgenticObservation(container, serverName, toolName, args, globalSessionId, 0, true, agentId, agentId);
  return injection;
}

/** Post-response hooks: finalize observation metrics + digital twin capture (A2). */
export async function runAgenticPostCallHooks(
  container: Container,
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  sessionHash: string,
  latencyMs: number,
  success: boolean,
  agentId?: string,
  responseSize?: number,
): Promise<void> {
  await hookAgenticObservation(container, serverName, toolName, args, sessionHash, latencyMs, success, agentId, agentId);
  if (success) {
    const responseShape = createHash('sha256')
      .update(`${responseSize ?? 0}:${JSON.stringify(args).slice(0, 512)}`)
      .digest('hex')
      .slice(0, 32);
    container.digitalTwin.record({
      serverName,
      toolName,
      latencyMs,
      responseShape,
      argsJson: args,
    });
  }
}

/** Denied call: audit + optional threat mesh contribution. */
export function runAgenticDeniedCallHooks(
  container: Container,
  params: AgenticAuditParams & { blockRule?: string },
): void {
  recordAgenticAudit(container, params);
  if (params.blockRule && params.toolName) {
    hookThreatMeshContribution(
      container,
      `${params.toolName}:${params.blockRule}`,
      params.blockRule,
      'high',
    );
  }
}