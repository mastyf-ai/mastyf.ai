/**
 * Persistence for industry-standard features (migration 012 tables).
 */
import type { IDatabase } from './database-interface.js';
export declare function applyIndustryStandardMigration(db: IDatabase): void;
export declare function applyRoadmapMigration016(db: IDatabase): void;
export declare function applyRoadmapMigration017(db: IDatabase): void;
export declare function applyRoadmapMigration018(db: IDatabase): void;
export declare function applyRoadmapMigration019(db: IDatabase): void;
export declare function applyRoadmapMigration013(db: IDatabase): void;
export declare function applyRoadmapMigration014(db: IDatabase): void;
export declare function applyRoadmapMigration015(db: IDatabase): void;
export interface CertificationRow {
    id: string;
    serverName: string;
    packageName: string;
    version: string;
    level: string;
    score: number;
    certified: boolean;
    attestationJws?: string;
    checksJson: string;
    issuedAt: string;
    expiresAt: string;
    tenantId: string;
}
export declare class IndustryStandardStore {
    private readonly db;
    constructor(db: IDatabase);
    private prep;
    saveCertification(row: CertificationRow): void;
    getCertification(serverName: string): CertificationRow | null;
    saveMtxSignature(hash: string, mtxJson: string, verified: boolean, tenantId?: string): void;
    recordChainEvent(event: {
        sessionId: string;
        agentId?: string;
        serverName: string;
        toolName: string;
        eventType: string;
        edgeJson?: string;
        blocked: boolean;
        tenantId?: string;
    }): void;
    upsertAgentReputation(agentId: string, score: number, tier: string, trend: string, eventsJson: string, tenantId?: string): void;
    getAgentReputation(agentId: string): {
        score: number;
        tier: string;
        trend: string;
    } | null;
    saveBenchmarkSubmission(row: {
        id: string;
        profile: string;
        packageName?: string;
        blockRate: number;
        falsePositiveRate: number;
        p95LatencyMs?: number;
        scorecardJson: string;
        submittedAt: string;
        tenantId?: string;
    }): void;
    saveCapabilityEdge(edge: {
        serverName: string;
        sourceTool: string;
        targetResource?: string;
        edgeType: string;
        metadataJson?: string;
        tenantId?: string;
    }): void;
    saveIntentBinding(row: {
        sessionId: string;
        agentId?: string;
        declaredIntent: string;
        allowedToolsJson: string;
        expiresAt: string;
        tenantId?: string;
    }): void;
    getIntentBinding(sessionId: string): {
        declaredIntent: string;
        allowedTools: string[];
        expiresAt: string;
    } | null;
    upsertSandboxTier(scopeType: string, scopeId: string, tier: string, rlStateJson?: string, tenantId?: string): void;
    getSandboxTier(scopeType: string, scopeId: string): string | null;
    listSandboxTiers(): Array<{
        scopeType: string;
        scopeId: string;
        tier: string;
    }>;
    saveFuzzRun(row: {
        id: string;
        serverName: string;
        total: number;
        blocked: number;
        passed: number;
        bypassesJson: string;
        tenantId?: string;
    }): void;
    savePlaybookRun(row: {
        id: string;
        playbookId: string;
        trigger: string;
        status: string;
        stepsJson: string;
        tenantId?: string;
    }): void;
    saveComplianceControlStatus(row: {
        framework: string;
        controlId: string;
        status: string;
        evidenceJson: string;
        evaluatedAt: string;
        tenantId?: string;
    }): void;
    listCertifications(tenantId?: string, limit?: number): CertificationRow[];
    listMtxSignatures(tenantId?: string, limit?: number): Array<{
        signatureHash: string;
        category: string;
        severity: 'critical' | 'high' | 'medium' | 'low';
        firstSeen: string;
        reportCount: number;
        verified: boolean;
    }>;
    listMtxPatternHashes(tenantId?: string, limit?: number): string[];
    listChainEvents(tenantId?: string, limit?: number): Array<{
        sessionId: string;
        agentId: string | null;
        serverName: string;
        toolName: string;
        eventType: string;
        blocked: boolean;
    }>;
    listCapabilityEdges(tenantId?: string, limit?: number): Array<{
        serverName: string;
        sourceTool: string;
        targetResource: string | null;
        edgeType: string;
    }>;
    listBenchmarkSubmissions(profile?: string, tenantId?: string, limit?: number): Array<{
        id: string;
        profile: string;
        packageName: string | null;
        blockRate: number;
        falsePositiveRate: number;
        p95LatencyMs: number | null;
        submittedAt: string;
    }>;
    getStatus(tenantId?: string): {
        certificationCount: number;
        mtxCount: number;
        benchmarkCount: number;
        chainEventCount: number;
        provenanceCount?: number;
        anomalyCount?: number;
    };
    saveProvenanceEvent(event: {
        eventId: string;
        actor: string;
        eventType: string;
        resourcePath: string;
        diff?: Record<string, unknown>;
        prevHash: string;
        entryHash: string;
        signature?: string;
        approvalId?: string;
        tenantId: string;
        createdAt: string;
    }): void;
    listProvenanceEvents(tenantId?: string, limit?: number): Array<{
        eventId: string;
        actor: string;
        eventType: string;
        resourcePath: string;
        diff?: Record<string, unknown>;
        prevHash: string;
        entryHash: string;
        signature?: string;
        approvalId?: string;
        tenantId: string;
        createdAt: string;
    }>;
    getLatestProvenanceHash(tenantId?: string): string | null;
    saveMerkleCheckpoint(checkpoint: {
        checkpointId: string;
        merkleRoot: string;
        eventCount: number;
    }, tenantId?: string): void;
    listFederatedDeltas(limit?: number, tenantId?: string): Array<{
        deltaId: string;
        modelVersion: string;
        signatureHash: string;
        sampleCount: number;
        privacyBudgetEpsilon: number;
        createdAt: string;
    }>;
    saveBehaviorFingerprint(fp: {
        agentId: string;
        sampleCount: number;
        avgInterCallMs: number;
        avgArgBytes: number;
        toolOrder: string[];
        argShapeHash: string;
        updatedAt: string;
    }, tenantId?: string): void;
    getBehaviorFingerprint(agentId: string): {
        agentId: string;
        sampleCount: number;
        avgInterCallMs: number;
        avgArgBytes: number;
        toolOrder: string[];
        argShapeHash: string;
        updatedAt: string;
    } | null;
    saveBehaviorAnomaly(params: {
        agentId: string;
        anomalyScore: number;
        reason: string;
        observation: unknown;
        blocked: boolean;
    }, tenantId?: string): void;
    listBehaviorAnomalies(limit?: number, tenantId?: string): Array<{
        agentId: string;
        anomalyScore: number;
        reason: string;
        createdAt: string;
    }>;
    saveFleetChainEvent(params: {
        globalSessionId: string;
        agentId: string;
        serverName: string;
        toolName: string;
        eventType: string;
        blocked: boolean;
        mitreTechnique?: string;
        edgeJson?: Record<string, unknown>;
    }, tenantId?: string): void;
    listFleetChainEvents(globalSessionId: string, limit?: number, tenantId?: string): Array<{
        globalSessionId: string;
        agentId: string;
        serverName: string;
        toolName: string;
        eventType: string;
        blocked: boolean;
        mitreTechnique?: string;
        edgeJson?: Record<string, unknown>;
        createdAt: string;
    }>;
    saveFleetChainAlert(alert: {
        alertId: string;
        globalSessionId: string;
        pattern: string;
        confidence: number;
        agents: string[];
        servers: string[];
        tools: string[];
        mitreTechniques: string[];
        description: string;
    }, tenantId?: string): void;
    listFleetChainAlerts(globalSessionId?: string, limit?: number, tenantId?: string): Array<{
        alertId: string;
        globalSessionId: string;
        pattern: string;
        confidence: number;
        agents: string[];
        servers: string[];
        tools: string[];
        mitreTechniques: string[];
        description: string;
        createdAt: string;
    }>;
    saveDigitalTwinSnapshot(snap: {
        id: string;
        serverName: string;
        schemaJson: Record<string, unknown>;
        latencyP50Ms: number;
        latencyP99Ms: number;
        responseShapeHash: string;
        sampleCount: number;
        capturedAt: string;
    }, tenantId?: string): void;
    saveReputationEntry(entry: {
        serverHash: string;
        dimensions: Record<string, number>;
        consensusScore: number;
        raterCount: number;
        level: string;
        updatedAt: string;
    }, tenantId?: string): void;
    getReputationEntry(serverHash: string): {
        serverHash: string;
        dimensions: Record<string, number>;
        consensusScore: number;
        raterCount: number;
        level: string;
        updatedAt: string;
    } | null;
    saveObservatoryMetric(params: {
        metricType: string;
        value: number;
        dimension?: Record<string, unknown>;
    }, tenantId?: string): void;
    listObservatoryMetrics(limit?: number, tenantId?: string): Array<{
        metricType: string;
        value: number;
        dimension?: Record<string, unknown>;
        recordedAt: string;
    }>;
    saveInsuranceRiskReport(report: {
        id: string;
        aleUsd: number;
        exposureScore: number;
        reportJson: string;
    }, tenantId?: string): void;
    private rowToCertification;
    saveFederatedDelta(delta: {
        deltaId: string;
        modelVersion: string;
        signatureHash: string;
        sampleCount: number;
        privacyBudgetEpsilon: number;
        createdAt: string;
    }, tenantId?: string): void;
    saveFederatedModelWeights(weights: {
        modelVersion: string;
        weights: number[];
        contributorCount: number;
        createdAt: string;
    }, tenantId?: string): void;
    getLatestFederatedModelWeights(tenantId?: string): {
        modelVersion: string;
        weights: number[];
        contributorCount: number;
        createdAt: string;
    } | null;
    saveFederatedRollout(rollout: {
        rolloutId: string;
        modelVersion: string;
        stage: string;
        approved: boolean;
        reason?: string;
        approvalId?: string;
    }, tenantId?: string): void;
    getRaterTrust(raterId: string, tenantId?: string): {
        raterId: string;
        trustScore: number;
        attestationCount: number;
    };
    bumpRaterTrust(raterId: string, delta?: number, tenantId?: string): void;
    saveReputationTrustEdge(edge: {
        fromRaterId: string;
        toRaterId: string;
        weight: number;
    }, tenantId?: string): void;
    listReputationTrustEdges(tenantId?: string): Array<{
        fromRaterId: string;
        toRaterId: string;
        weight: number;
    }>;
    saveFederatedGradientSnapshot(snapshot: {
        snapshotId: string;
        modelVersion: string;
        gradient: number[];
        contributorCount: number;
        createdAt: string;
    }, tenantId?: string): void;
    saveReputationRaterVote(vote: {
        serverHash: string;
        raterId: string;
        dimensions: Record<string, number>;
        raterWeight: number;
        attestationJws?: string;
    }, tenantId?: string): void;
    listReputationRaterVotes(serverHash: string, tenantId?: string): Array<{
        raterId: string;
        dimensions: Record<string, number>;
        raterWeight: number;
        attestationJws?: string;
    }>;
    saveThreatModelReport(report: {
        reportId: string;
        title: string;
        configPath?: string;
        reportJson: string;
    }, tenantId?: string): void;
    getLatestThreatModelReport(tenantId?: string): {
        reportId: string;
        title: string;
        configPath?: string;
        reportJson: string;
        createdAt: string;
    } | null;
    saveDigitalTwinObservation(obs: {
        serverName: string;
        toolName: string;
        argsJson?: Record<string, unknown>;
        latencyMs: number;
        responseShape: string;
    }, tenantId?: string): void;
    listDigitalTwinObservations(serverName: string, limit?: number, tenantId?: string): Array<{
        serverName: string;
        toolName: string;
        argsJson?: Record<string, unknown>;
        latencyMs: number;
        responseShape: string;
        recordedAt: string;
    }>;
    savePolicyDraftApproval(draft: {
        requestId: string;
        goal: string;
        ruleJson: string;
        yaml: string;
        status: string;
        createdAt: string;
    }, tenantId?: string): void;
    getPolicyDraftApproval(requestId: string, tenantId?: string): {
        requestId: string;
        goal: string;
        ruleJson: string;
        yaml: string;
        status: string;
        createdAt: string;
    } | null;
    listPolicyDraftApprovals(limit?: number, tenantId?: string): Array<{
        requestId: string;
        goal: string;
        ruleJson: string;
        yaml: string;
        status: string;
        createdAt: string;
    }>;
    saveObservatoryAlert(alert: {
        alertType: string;
        severity: string;
        message: string;
        metricType?: string;
        threshold?: number;
        observedValue?: number;
    }, tenantId?: string): void;
    listObservatoryAlerts(limit?: number, tenantId?: string): Array<{
        alertType: string;
        severity: string;
        message: string;
        metricType?: string;
        threshold?: number;
        observedValue?: number;
        createdAt: string;
    }>;
}
//# sourceMappingURL=industry-standard-store.d.ts.map