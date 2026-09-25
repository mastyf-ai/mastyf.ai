import { stepUpSessionKey, isStepUpCleared, markStepUpPending, hasPendingStepUp, } from './step-up-session.js';
import { getActiveSpiffeId } from '../../utils/mtls-config.js';
export class ZeroTrustVerificationEngine {
    reputation;
    biometrics;
    intent;
    certifier;
    approvalGate;
    constructor(reputation, biometrics, intent, certifier, approvalGate) {
        this.reputation = reputation;
        this.biometrics = biometrics;
        this.intent = intent;
        this.certifier = certifier;
        this.approvalGate = approvalGate;
    }
    score(ctx) {
        const dimensions = {};
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
        let action = 'allow';
        let reason = 'Composite score within allow threshold';
        let stepUpRequestId;
        if (composite < 0.35) {
            action = 'block';
            reason = 'Composite zero-trust score below block threshold';
        }
        else if (composite < 0.55) {
            if (hasPendingStepUp(sessionKey)) {
                action = 'block';
                reason = 'Awaiting zero-trust step-up approval';
            }
            else {
                action = 'step_up';
                reason = 'Step-up authentication required';
                if (this.approvalGate) {
                    stepUpRequestId = this.approvalGate.submit('zero-trust-step-up', `Step-up required for ${ctx.toolName} on ${ctx.serverName} (score=${composite.toFixed(2)})`, [], 600_000);
                    markStepUpPending(sessionKey, stepUpRequestId);
                }
            }
        }
        return { composite, dimensions, action, reason, stepUpRequestId };
    }
    scoreSpiffe(ctx) {
        const spiffeId = ctx.spiffeId ?? getActiveSpiffeId();
        if (!spiffeId)
            return ctx.authenticated ? 0.6 : 0.3;
        if (!spiffeId.includes('spiffe://'))
            return 0.5;
        const socketConfigured = Boolean(process.env.MASTYF_AI_SPIFFE_SOCKET_PATH?.trim());
        const mtlsConfigured = Boolean(process.env.MCP_TLS_CERT?.trim() || process.env.MCP_TLS_ENABLED === 'true');
        if (socketConfigured || mtlsConfigured)
            return 0.98;
        return 0.95;
    }
    scoreBiometrics(ctx) {
        if (!this.biometrics)
            return 0.5;
        const anomaly = this.biometrics.scoreAnomaly(ctx.agentId, {
            agentId: ctx.agentId,
            toolName: ctx.toolName,
            argBytes: 64,
            timestamp: Date.now(),
            credentialIdentity: ctx.credentialIdentity,
        });
        return Math.max(0.1, 1 - anomaly.score);
    }
    scoreIntent(ctx) {
        if (!this.intent)
            return 0.5;
        const binding = this.intent.getIntent(ctx.sessionId);
        if (!binding)
            return ctx.declaredIntent ? 0.4 : 0.5;
        return binding.allowedTools.includes(ctx.toolName) ? 0.95 : 0.2;
    }
    scoreReputation(agentId) {
        if (!this.reputation)
            return 0.5;
        const rep = this.reputation.getScore(agentId);
        const tierMap = {
            trusted: 0.95,
            standard: 0.7,
            suspicious: 0.35,
            blocked: 0.05,
        };
        return tierMap[rep.tier] ?? 0.5;
    }
    scoreCertification(serverName) {
        if (!this.certifier)
            return 0.5;
        const cert = this.certifier.getCertification(serverName);
        if (!cert?.certified)
            return 0.3;
        const levelMap = { bronze: 0.5, silver: 0.65, gold: 0.85, platinum: 0.95 };
        return levelMap[cert.level] ?? 0.5;
    }
    scoreContext(ctx) {
        let score = 0.7;
        if (ctx.dataSensitivity === 'high')
            score -= 0.15;
        const hour = ctx.hourUtc ?? new Date().getUTCHours();
        if (hour < 6 || hour > 22)
            score -= 0.1;
        const allowedRegions = process.env.MASTYF_AI_ZERO_TRUST_ALLOWED_REGIONS?.split(',').map(r => r.trim().toUpperCase()).filter(Boolean);
        if (allowedRegions?.length && ctx.geoRegion && !allowedRegions.includes(ctx.geoRegion.toUpperCase())) {
            score -= 0.25;
        }
        return Math.max(0.1, Math.min(1, score));
    }
}
//# sourceMappingURL=verification-engine.js.map