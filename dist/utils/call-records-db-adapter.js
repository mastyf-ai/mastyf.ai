export class CallRecordsDbAdapter {
    records;
    constructor(records) {
        this.records = records;
    }
    async initialize() { }
    async getRecentSuccessRate() {
        return null;
    }
    async addSecurityScan() {
        throw new Error('CallRecordsDbAdapter is read-only');
    }
    async getLatestSecurityScan() {
        return null;
    }
    async getDistinctScannedServers(tenantId) {
        return this.distinctServers(tenantId);
    }
    async getDistinctActiveServers(tenantId) {
        return this.distinctServers(tenantId);
    }
    distinctServers(tenantId) {
        const recs = tenantId
            ? this.records.filter((r) => (r.tenantId || 'default') === tenantId)
            : this.records;
        return [...new Set(recs.map((r) => r.serverName).filter(Boolean))];
    }
    async addCostRecord() {
        throw new Error('CallRecordsDbAdapter is read-only');
    }
    async addHealthCheck() {
        throw new Error('CallRecordsDbAdapter is read-only');
    }
    async addCallRecord() {
        throw new Error('CallRecordsDbAdapter is read-only');
    }
    async getCallRecordsForServer(serverName, limit, tenantId) {
        let recs = this.records.filter((r) => r.serverName === serverName);
        if (tenantId) {
            recs = recs.filter((r) => (r.tenantId || 'default') === tenantId);
        }
        recs = [...recs].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
        if (limit != null && limit > 0)
            recs = recs.slice(0, limit);
        return recs;
    }
    async transactionSync(fn) {
        return fn();
    }
    async transaction(fn) {
        return fn();
    }
    flush() { }
    async close() { }
}
//# sourceMappingURL=call-records-db-adapter.js.map