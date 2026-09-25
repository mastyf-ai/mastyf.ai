export class RequestAuditor {
    records = [];
    maxRecords;
    constructor(maxRecords = 10000) {
        this.maxRecords = maxRecords;
    }
    record(params) {
        // Redact argument values — only preserve keys and types
        const argsSummary = this.redactArgs(params.args);
        const record = {
            recordId: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: new Date().toISOString(),
            sessionId: params.sessionId,
            method: params.method,
            toolName: params.toolName,
            argsSummary,
            userId: params.userId,
            userTier: params.userTier,
            latencyMs: params.latencyMs,
            blocked: params.blocked,
            blockReason: params.blockReason,
            responseSize: params.responseSize,
            statusCode: params.statusCode,
        };
        this.records.push(record);
        if (this.records.length > this.maxRecords) {
            this.records = this.records.slice(-this.maxRecords);
        }
        return record;
    }
    /** Redact argument values — only keep keys and types. */
    redactArgs(args) {
        if (!args || Object.keys(args).length === 0)
            return '{}';
        const summary = {};
        for (const [key, value] of Object.entries(args)) {
            if (typeof value === 'string') {
                summary[key] = `string(${value.length} chars)`;
            }
            else if (typeof value === 'number') {
                summary[key] = `number(${value})`;
            }
            else if (typeof value === 'boolean') {
                summary[key] = `boolean(${value})`;
            }
            else if (Array.isArray(value)) {
                summary[key] = `array(${value.length} items)`;
            }
            else if (value === null || value === undefined) {
                summary[key] = `${value}`;
            }
            else {
                summary[key] = 'object';
            }
        }
        return JSON.stringify(summary);
    }
    /** Get recent audit records. */
    getRecords(limit = 50) {
        return this.records.slice(-limit).reverse();
    }
    /** Get records filtered by method. */
    getRecordsByMethod(method, limit = 50) {
        return this.records
            .filter(r => r.method === method)
            .slice(-limit)
            .reverse();
    }
    /** Get records filtered by session. */
    getRecordsBySession(sessionId, limit = 50) {
        return this.records
            .filter(r => r.sessionId === sessionId)
            .slice(-limit)
            .reverse();
    }
    /** Get audit statistics. */
    getStats() {
        const total = this.records.length;
        const blocked = this.records.filter(r => r.blocked).length;
        const avgLatency = total > 0
            ? Math.round(this.records.reduce((s, r) => s + r.latencyMs, 0) / total)
            : 0;
        return {
            totalRecords: total,
            totalBlocked: blocked,
            totalAllowed: total - blocked,
            averageLatencyMs: avgLatency,
        };
    }
}
//# sourceMappingURL=request-auditor.js.map