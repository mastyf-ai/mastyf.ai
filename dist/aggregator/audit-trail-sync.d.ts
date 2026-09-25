/**
 * Audit Trail Sync — periodically syncs per-instance SQLite history
 * databases to the central PostgreSQL unified_audit_trail table.
 *
 * This ensures all policy decisions, call records, security scans,
 * cost records, and health checks are aggregated in one place.
 */
import { HistoryDatabase } from '../database/history-db.js';
import type { AttackLearningState } from '../ai/instant-attack-learning.js';
export interface SyncConfig {
    instanceId: string;
    instanceName: string;
    syncIntervalMs: number;
    batchSize: number;
    databaseUrl: string;
}
export declare class AuditTrailSync {
    private localDb;
    private pgPool;
    private config;
    private syncTimer;
    constructor(localDb: HistoryDatabase, config?: Partial<SyncConfig>);
    /** Region label stored in mastyf_ai_instances.metadata for dashboard region filter. */
    private instanceMetadata;
    initialize(): Promise<void>;
    /** Start periodic sync */
    start(): void;
    /** Stop periodic sync */
    stop(): void;
    /** Sync all data types to central PG */
    syncAll(): Promise<void>;
    /** Sync call records from local SQLite to unified_audit_trail */
    private syncCallRecords;
    /** Sync security scans to unified_security_scans */
    private syncSecurityScans;
    /** Sync cost records to unified_cost_records */
    private syncCostRecords;
    /** Sync health checks to unified_health_checks */
    private syncHealthChecks;
    /** Send heartbeat to keep instance status active */
    private sendHeartbeat;
    /** Insert a policy decision directly into unified_audit_trail (real-time) */
    recordPolicyDecision(decision: {
        serverName: string;
        toolName: string;
        action: 'pass' | 'block' | 'flag' | 'error';
        ruleName?: string;
        reason?: string;
        requestTokens?: number;
        responseTokens?: number;
        totalTokens?: number;
        durationMs?: number;
        estimatedCostUsd?: number;
        model?: string;
        clientIp?: string;
        authSuccess?: boolean;
        severity?: 'info' | 'warn' | 'critical' | 'emergency';
        metadata?: Record<string, unknown>;
        tenantId?: string;
    }): Promise<void>;
    /** Record AI learning outcome to shared PG */
    recordLearningOutcome(outcome: {
        suggestionId: string;
        ruleName: string;
        source: 'baseline' | 'cost' | 'threat' | 'assist' | 'pattern';
        action: 'applied' | 'rejected' | 'modified' | 'ignored';
        confidence: number;
        userFeedback?: string;
    }): Promise<void>;
    /** Persist baseline to shared PG */
    persistBaseline(baseline: {
        serverName: string;
        toolName: string;
        sampleCount: number;
        avgTokens: number;
        stddevTokens: number;
        avgLatencyMs: number;
        stddevLatencyMs: number;
        hourlyDistribution: number[];
        argumentKeys: string[];
    }): Promise<void>;
    /** Get all baselines from shared PG (across all instances) */
    getSharedBaselines(): Promise<any[]>;
    /** Get aggregated metrics across all instances (optional tenant filter via unified tables). */
    getAggregatedMetrics(tenantId?: string): Promise<{
        totalInstances: number;
        activeInstances: number;
        totalRequests: number;
        totalBlocked: number;
        totalCost: number;
        instances: any[];
    }>;
    /** Paginated unified cost records for a tenant. */
    getUnifiedCostRecords(tenantId: string, opts?: {
        serverName?: string;
        limit?: number;
        offset?: number;
    }): Promise<any[]>;
    /** Paginated unified security scans for a tenant. */
    getUnifiedSecurityScans(tenantId: string, opts?: {
        serverName?: string;
        limit?: number;
        offset?: number;
    }): Promise<any[]>;
    /** Paginated unified health checks for a tenant. */
    getUnifiedHealthChecks(tenantId: string, opts?: {
        serverName?: string;
        limit?: number;
        offset?: number;
    }): Promise<any[]>;
    private queryUnifiedTable;
    /** Load shared instant attack learning state (multi-replica). */
    getAttackLearningState(tenantId?: string): Promise<AttackLearningState | null>;
    /** Persist shared instant attack learning state. */
    persistAttackLearningState(state: AttackLearningState, tenantId?: string): Promise<void>;
    /** Get paginated audit trail */
    getAuditTrail(options?: {
        serverName?: string;
        action?: string;
        severity?: string;
        tenantId?: string;
        limit?: number;
        offset?: number;
    }): Promise<any[]>;
    close(): Promise<void>;
}
//# sourceMappingURL=audit-trail-sync.d.ts.map