/**
 * C3 — Zero-Trust Continuous Verification Engine (per-call composite score).
 */
import type { BehaviorFingerprintEngine } from '../biometrics/behavior-fingerprint.js';
import type { ReputationEngine } from '../agent-reputation/reputation-engine.js';
import type { IntentEngine } from '../intent-binding/intent-engine.js';
import type { MCPCertifier } from '../certification/certifier.js';
import type { ApprovalGate } from '../core.js';
import {
  stepUpSessionKey,
  isStepUpCleared,
  markStepUpPending,
  hasPendingStepUp,
} from './step-up-session.js';
import { getActiveSpiffeId } from '../../utils/mtls-config.js';

export interface VerificationContext {
  agentId: string;
  sessionId: string;
  serverName: string;
  toolName: string;
  authenticated: boolean;
  declaredIntent?: string;
  geoRegion?: string;
  hourUtc?: number;
  dataSensitivity?: 'low' | 'medium' | 'high';
  /** SPIFFE ID from workload API / mTLS cert when available */
  spiffeId?: string;
  credentialIdentity?: string;
}

export interface VerificationScore {
  composite: number;
  dimensions: Record<string, number>;
  action: 'allow' | 'step_up' | 'block';
  reason: string;
  stepUpRequestId?: string;
}

export class ZeroTrustVerificationEngine {
  constructor(
    private readonly reputation?: ReputationEngine,
    private readonly biometrics?: BehaviorFingerprintEngine,
    private readonly intent?: IntentEngine,
    private readonly certifier?: MCPCertifier,
    private readonly approvalGate?: ApprovalGate,
  ) {}

  score(ctx: VerificationContext): VerificationScore {
    const dimensions: Record<string, number> = {};

    dimensions.identity = ctx.authenticated ? 0.9 : 0.3;
    dimensions.spiffe = this.scoreSpiffe(ctx);
    dimensions.intent = this.scoreIntent(ctx);
    dimensions.reputation = this.scoreReputation(ctx.agentId);
    dimensions.biometrics = this.scoreBiometrics(ctx);
    dimensions.certification = this.scoreCertification(ctx.serverName);
    dimensions.context = this.scoreContext(ctx);

    const weights = {
      identity: 0.2,
      spiffe: 0.15,
      intent: 0.15,
      reputation: 0.15,
      biometrics: 0.1,
      certification: 0.15,
      context: 0.1,
    };
    let composite = 0;
    for (const [k, w] of Object.entries(weights)) {
      composite += (dimensions[k] ?? 0.5) * w;
    }
    composite = Math.round(composite * 1000) / 1000;

    const sessionKey = stepUpSessionKey(ctx.agentId, ctx.sessionId);
    if (isStepUpCleared(sessionKey)) {
      return {
        composite,
        dimensions,
        action: 'allow',
        reason: 'Step-up authentication cleared for session',
      };
    }

    let action: VerificationScore['action'] = 'allow';
    let reason = 'Composite score within allow threshold';
    let stepUpRequestId: string | undefined;

    if (composite < 0.35) {
      action = 'block';
      reason = 'Composite zero-trust score below block threshold';
    } else if (composite < 0.55) {
      if (hasPendingStepUp(sessionKey)) {
        action = 'block';
        reason = 'Awaiting zero-trust step-up approval';
      } else {
        action = 'step_up';
        reason = 'Step-up authentication required';
        if (this.approvalGate) {
          stepUpRequestId = this.approvalGate.submit(
            'zero-trust-step-up',
            `Step-up required for ${ctx.toolName} on ${ctx.serverName} (score=${composite.toFixed(2)})`,
            [],
            600_000,
          );
          markStepUpPending(sessionKey, stepUpRequestId);
        }
      }
    }

    return { composite, dimensions, action, reason, stepUpRequestId };
  }

  private scoreSpiffe(ctx: VerificationContext): number {
    const spiffeId = ctx.spiffeId ?? getActiveSpiffeId();
    if (!spiffeId) return ctx.authenticated ? 0.6 : 0.3;
    if (!spiffeId.includes('spiffe://')) return 0.5;
    const socketConfigured = Boolean(process.env.GUARDIAN_SPIFFE_SOCKET_PATH?.trim());
    const mtlsConfigured = Boolean(process.env.MCP_TLS_CERT?.trim() || process.env.MCP_TLS_ENABLED === 'true');
    if (socketConfigured || mtlsConfigured) return 0.98;
    return 0.95;
  }

  private scoreBiometrics(ctx: VerificationContext): number {
    if (!this.biometrics) return 0.5;
    const anomaly = this.biometrics.scoreAnomaly(ctx.agentId, {
      agentId: ctx.agentId,
      toolName: ctx.toolName,
      argBytes: 64,
      timestamp: Date.now(),
      credentialIdentity: ctx.credentialIdentity,
    });
    return Math.max(0.1, 1 - anomaly.score);
  }

  private scoreIntent(ctx: VerificationContext): number {
    if (!this.intent) return 0.5;
    const binding = this.intent.getIntent(ctx.sessionId);
    if (!binding) return ctx.declaredIntent ? 0.4 : 0.5;
    return binding.allowedTools.includes(ctx.toolName) ? 0.95 : 0.2;
  }

  private scoreReputation(agentId: string): number {
    if (!this.reputation) return 0.5;
    const rep = this.reputation.getScore(agentId);
    const tierMap: Record<string, number> = {
      trusted: 0.95,
      standard: 0.7,
      suspicious: 0.35,
      blocked: 0.05,
    };
    return tierMap[rep.tier] ?? 0.5;
  }

  private scoreCertification(serverName: string): number {
    if (!this.certifier) return 0.5;
    const cert = this.certifier.getCertification(serverName);
    if (!cert?.certified) return 0.3;
    const levelMap: Record<string, number> = { bronze: 0.5, silver: 0.65, gold: 0.85, platinum: 0.95 };
    return levelMap[cert.level] ?? 0.5;
  }

  private scoreContext(ctx: VerificationContext): number {
    let score = 0.7;
    if (ctx.dataSensitivity === 'high') score -= 0.15;
    const hour = ctx.hourUtc ?? new Date().getUTCHours();
    if (hour < 6 || hour > 22) score -= 0.1;
    const allowedRegions = process.env.GUARDIAN_ZERO_TRUST_ALLOWED_REGIONS?.split(',').map(r => r.trim().toUpperCase()).filter(Boolean);
    if (allowedRegions?.length && ctx.geoRegion && !allowedRegions.includes(ctx.geoRegion.toUpperCase())) {
      score -= 0.25;
    }
    return Math.max(0.1, Math.min(1, score));
  }
}
