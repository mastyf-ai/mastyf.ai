/**
 * Pattern Analyzer — analyzes behavioral observations to identify:
 *   - Which tools are actually used (vs declared in tools/list)
 *   - Argument value ranges and types
 *   - Call frequency baselines (for rate limiting)
 *   - Tool co-occurrence anomalies (unusual tool sequences)
 *   - Peak usage periods
 */
export class PatternAnalyzer {
    /**
     * Analyze a completed observation window and produce tool profiles.
     */
    analyze(window, stats) {
        const durationMin = (Date.now() - new Date(window.startedAt).getTime()) / 60000;
        const toolProfiles = [];
        for (const toolName of stats.uniqueTools) {
            const observations = window.byTool[toolName] || [];
            if (observations.length === 0)
                continue;
            const profile = this.buildToolProfile(toolName, observations, window, stats, durationMin);
            toolProfiles.push(profile);
        }
        // Sort by call count descending
        toolProfiles.sort((a, b) => b.callCount - a.callCount);
        // Identify normal workflows
        const totalSequences = stats.commonSequences.reduce((sum, s) => sum + s.count, 0);
        const normalWorkflows = stats.commonSequences
            .filter(s => s.count >= 3) // At least 3 occurrences
            .map(s => ({
            sequence: s.sequence,
            count: s.count,
            confidence: Math.min(s.count / Math.max(totalSequences, 1), 1),
        }))
            .slice(0, 10);
        // Unused tools (observed < 3 times)
        const unusedTools = toolProfiles
            .filter(t => t.callCount < 3)
            .map(t => `${t.toolName} (${t.serverName})`);
        // High error tools
        const highErrorTools = toolProfiles
            .filter(t => t.errorRate > 0.10)
            .map(t => `${t.toolName}: ${(t.errorRate * 100).toFixed(1)}% error rate`);
        return {
            windowId: window.windowId,
            toolProfiles,
            totalObservations: window.totalCalls,
            durationMin: Math.round(durationMin * 100) / 100,
            normalWorkflows,
            unusedTools,
            highErrorTools,
        };
    }
    /**
     * Build a detailed profile for a single tool.
     */
    buildToolProfile(toolName, observations, window, stats, durationMin) {
        // Call rate
        const callRatePerMin = observations.length / Math.max(durationMin, 1);
        // Peak rate: find the highest calls-per-minute within any 1-minute bucket
        const callsByMinute = new Map();
        for (const obs of observations) {
            const minute = Math.floor(obs.timestamp / 60000);
            callsByMinute.set(minute, (callsByMinute.get(minute) || 0) + 1);
        }
        const peakRatePerMin = callsByMinute.size > 0 ? Math.max(...callsByMinute.values()) : 0;
        // Argument schema
        const argumentSchema = {};
        const argKeys = stats.argumentKeysByTool[toolName] || [];
        const totalObs = observations.length;
        for (const key of argKeys) {
            const providedCount = observations.filter(o => o.argumentKeys.includes(key)).length;
            argumentSchema[key] = {
                type: stats.argumentTypesByTool[toolName]?.[key] || 'unknown',
                required: providedCount / totalObs > 0.8, // Required if >80% of calls include it
                observedValues: providedCount,
            };
        }
        // Preceding tools
        const precedingTools = this.getRelatedTools(toolName, window.coOccurrences, 'preceding');
        // Following tools
        const followingTools = this.getRelatedTools(toolName, window.coOccurrences, 'following');
        return {
            toolName,
            serverName: observations[0]?.serverName || 'unknown',
            callCount: observations.length,
            callRatePerMin: Math.round(callRatePerMin * 100) / 100,
            peakRatePerMin,
            argumentSchema,
            latencyP50: stats.toolLatencyP50[toolName] || 0,
            latencyP95: stats.toolLatencyP95[toolName] || 0,
            errorRate: stats.toolErrorRate[toolName] || 0,
            precedingTools,
            followingTools,
        };
    }
    getRelatedTools(toolName, coOccurrences, direction) {
        const result = [];
        if (direction === 'preceding') {
            // Tools that call this one
            for (const [preceding, targets] of Object.entries(coOccurrences)) {
                if (targets[toolName]) {
                    result.push({ tool: preceding, count: targets[toolName] });
                }
            }
        }
        else {
            // Tools called after this one
            const targets = coOccurrences[toolName];
            if (targets) {
                for (const [following, count] of Object.entries(targets)) {
                    result.push({ tool: following, count });
                }
            }
        }
        return result.sort((a, b) => b.count - a.count).slice(0, 5);
    }
}
//# sourceMappingURL=pattern-analyzer.js.map