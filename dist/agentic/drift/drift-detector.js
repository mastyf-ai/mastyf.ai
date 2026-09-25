/**
 * Drift Detector — monitors MCP server behavior for anomalies indicating
 * compromise, silent updates, or degradation.
 *
 * Compares current behavior (tool schemas, response shapes, latency profiles,
 * error patterns) against a known-good baseline snapshot.
 */
import { Logger } from '../../utils/logger.js';
import { AgenticResult as Result } from '../core.js';
export class DriftDetector {
    baselines = new Map();
    /**
     * Capture a behavioral baseline for a server.
     */
    captureBaseline(serverName, tools, performance, configSnapshot) {
        const toolSchemas = {};
        for (const t of tools) {
            const schemaHash = this.hashString(JSON.stringify(t.inputSchema));
            toolSchemas[t.name] = {
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
                schemaHash,
            };
        }
        const baseline = {
            id: crypto.randomUUID(),
            serverName,
            capturedAt: new Date().toISOString(),
            toolSchemas,
            responseShapes: {},
            performance: { ...performance },
            configSnapshot,
        };
        // Store baseline
        if (!this.baselines.has(serverName)) {
            this.baselines.set(serverName, []);
        }
        this.baselines.get(serverName).push(baseline);
        // Keep only the last 10 baselines
        const baselines = this.baselines.get(serverName);
        if (baselines.length > 10)
            baselines.shift();
        Logger.info(`[DriftDetector] Captured baseline ${baseline.id} for ${serverName}: ${Object.keys(toolSchemas).length} tools`);
        return baseline;
    }
    /**
     * Detect drift between current server behavior and a baseline.
     */
    detectDrift(baseline, currentTools, currentPerformance) {
        const findings = [];
        const decisions = [];
        // 1. Schema drift
        const currentToolMap = new Map(currentTools.map(t => [t.name, t]));
        const baselineTools = new Set(Object.keys(baseline.toolSchemas));
        // New tools added
        for (const [name] of currentToolMap) {
            if (!baselineTools.has(name)) {
                findings.push({
                    type: 'new_tool',
                    severity: 'medium',
                    description: `New tool detected: ${name}`,
                    metric: 'tool_count',
                    baseline: baselineTools.size,
                    current: currentTools.length,
                    changePercent: 100,
                });
            }
        }
        // Tools removed
        for (const name of baselineTools) {
            if (!currentToolMap.has(name)) {
                findings.push({
                    type: 'removed_tool',
                    severity: 'high',
                    description: `Tool removed: ${name}`,
                    metric: 'tool_count',
                    baseline: baselineTools.size,
                    current: currentTools.length,
                    changePercent: -100,
                });
            }
        }
        // Schema changes for existing tools
        for (const name of baselineTools) {
            const baselineSchema = baseline.toolSchemas[name];
            const currentTool = currentToolMap.get(name);
            if (!baselineSchema || !currentTool)
                continue;
            const currentSchemaHash = this.hashString(JSON.stringify(currentTool.inputSchema));
            if (currentSchemaHash !== baselineSchema.schemaHash) {
                findings.push({
                    type: 'schema_change',
                    severity: 'high',
                    description: `Schema changed for tool: ${name}`,
                    metric: `schema_hash:${name}`,
                    baseline: baselineSchema.schemaHash,
                    current: currentSchemaHash,
                    changePercent: 100,
                });
            }
        }
        // 2. Performance degradation
        const perfChange = this.detectPerformanceDrift(baseline.performance, currentPerformance);
        findings.push(...perfChange);
        // Compute drift score
        const driftScore = this.computeDriftScore(findings);
        const recommendRollback = driftScore > 50;
        // Generate decision
        if (findings.length > 0) {
            decisions.push({
                decisionId: crypto.randomUUID(),
                source: 'drift-detector',
                rationale: `Detected ${findings.length} drift indicators for ${baseline.serverName}`,
                confidence: driftScore / 100,
                requiresApproval: recommendRollback,
                suggestedAction: recommendRollback ? 'ROLLBACK' : 'WARN',
                timestamp: new Date().toISOString(),
                metadata: { findings: findings.map(f => f.type), driftScore },
            });
        }
        return Result.ok({
            drifted: findings.length > 0,
            serverName: baseline.serverName,
            baselineId: baseline.id,
            driftScore: Math.round(driftScore),
            findings,
            recommendRollback,
            summary: findings.length > 0
                ? `Detected ${findings.length} drift indicators (score: ${Math.round(driftScore)}/100): ${findings.map(f => f.description).join('; ')}`
                : 'No drift detected — server behavior matches baseline',
        }, decisions);
    }
    /**
     * Detect performance drift.
     */
    detectPerformanceDrift(baseline, current) {
        const findings = [];
        // Latency degradation > 50% increase
        if (current.latencyP95 > baseline.latencyP95 * 1.5) {
            findings.push({
                type: 'performance_degradation',
                severity: 'high',
                description: `P95 latency increased significantly`,
                metric: 'latencyP95',
                baseline: baseline.latencyP95,
                current: current.latencyP95,
                changePercent: Math.round(((current.latencyP95 - baseline.latencyP95) / baseline.latencyP95) * 100),
            });
        }
        // Success rate drop > 10%
        if (current.successRate < baseline.successRate - 0.10) {
            findings.push({
                type: 'error_increase',
                severity: 'critical',
                description: `Success rate dropped significantly`,
                metric: 'successRate',
                baseline: baseline.successRate,
                current: current.successRate,
                changePercent: Math.round(((current.successRate - baseline.successRate) / baseline.successRate) * 100),
            });
        }
        // Response size change > 100%
        if (Math.abs(current.avgResponseSize - baseline.avgResponseSize) > baseline.avgResponseSize) {
            findings.push({
                type: 'response_change',
                severity: 'medium',
                description: `Response size changed dramatically`,
                metric: 'avgResponseSize',
                baseline: baseline.avgResponseSize,
                current: current.avgResponseSize,
                changePercent: Math.round(((current.avgResponseSize - baseline.avgResponseSize) / baseline.avgResponseSize) * 100),
            });
        }
        return findings;
    }
    /**
     * Compute an overall drift score from individual findings.
     */
    computeDriftScore(findings) {
        if (findings.length === 0)
            return 0;
        const severityWeights = {
            critical: 30,
            high: 20,
            medium: 10,
            low: 5,
        };
        let score = 0;
        for (const f of findings) {
            score += severityWeights[f.severity];
        }
        return Math.min(score, 100);
    }
    /**
     * Get the most recent baseline for a server.
     */
    getLatestBaseline(serverName) {
        const baselines = this.baselines.get(serverName);
        return baselines?.[baselines.length - 1];
    }
    /**
     * Get all baselines for a server.
     */
    getBaselines(serverName) {
        return this.baselines.get(serverName) || [];
    }
    /**
     * Get a specific baseline by id.
     */
    getBaseline(serverName, baselineId) {
        return this.baselines.get(serverName)?.find(b => b.id === baselineId);
    }
    /** Simple string hashing for schema comparison. */
    hashString(input) {
        let hash = 0;
        for (let i = 0; i < input.length; i++) {
            const char = input.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash.toString(16);
    }
}
//# sourceMappingURL=drift-detector.js.map