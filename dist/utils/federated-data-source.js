/**
 * Resolves dashboard chart data source: unified PG, fleet SQLite merge, or local db.
 */
import { existsSync } from 'fs';
import { HistoryDatabase } from '../database/history-db.js';
import { getAllActiveServerNames, loadAllCallRecords, } from './db-aggregate.js';
import { CallRecordsDbAdapter } from './call-records-db-adapter.js';
import { UnifiedDataReader, initUnifiedDataReaderPool, getUnifiedDataReaderPool, } from './unified-data-reader.js';
import { parseWindowDays, windowRangeMs } from './time-buckets.js';
import { Logger } from './logger.js';
function dashboardDataSourcePref() {
    return (process.env['MASTYF_AI_DASHBOARD_DATA_SOURCE'] || 'auto').toLowerCase();
}
export function resolveFederatedMode(localDb) {
    const pref = dashboardDataSourcePref();
    const hasPgUrl = Boolean(process.env['DATABASE_URL']);
    const dbType = (process.env['DB_TYPE'] || 'sqlite').toLowerCase();
    const fleetPaths = (process.env['MASTYF_AI_FLEET_DB_PATHS'] || '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
    if (pref === 'local')
        return 'local';
    if (pref === 'fleet' && fleetPaths.length > 0)
        return 'sqlite-fleet';
    if (pref === 'unified' && hasPgUrl)
        return 'unified';
    if (pref === 'auto' || pref === 'unified') {
        if (hasPgUrl && (process.env['MASTYF_AI_AUDIT_SYNC_ENABLED'] === 'true' || pref === 'unified')) {
            return 'unified';
        }
        if (hasPgUrl && dbType === 'postgres')
            return 'postgres-direct';
        if (fleetPaths.length > 1)
            return 'sqlite-fleet';
    }
    if (dbType === 'postgres' && hasPgUrl)
        return 'postgres-direct';
    if (fleetPaths.length > 1)
        return 'sqlite-fleet';
    return 'local';
}
function dataSourcesForMode(mode) {
    switch (mode) {
        case 'unified':
            return ['unified_audit_trail'];
        case 'postgres-direct':
            return ['postgres.call_records'];
        case 'sqlite-fleet':
            return ['sqlite-fleet'];
        default:
            return ['history.db'];
    }
}
async function loadFleetMergedRecords(tenantId, windowDays) {
    const paths = (process.env['MASTYF_AI_FLEET_DB_PATHS'] || '')
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p && existsSync(p));
    const { startMs, endMs } = windowRangeMs(parseWindowDays(windowDays));
    const merged = [];
    for (const dbPath of paths) {
        const db = new HistoryDatabase(dbPath);
        await db.initialize();
        try {
            const srvs = await getAllActiveServerNames(db, tenantId);
            const recs = await loadAllCallRecords(db, srvs, tenantId);
            for (const r of recs) {
                const ts = Date.parse(String(r.timestamp || ''));
                if (Number.isFinite(ts) && ts >= startMs && ts <= endMs)
                    merged.push(r);
            }
        }
        finally {
            await db.close();
        }
    }
    return merged;
}
export async function resolveFederatedChartDb(localDb, tenantId, windowDaysInput, region) {
    const windowDays = parseWindowDays(windowDaysInput);
    const mode = resolveFederatedMode(localDb);
    const dataSources = dataSourcesForMode(mode);
    if (mode === 'unified') {
        let pool = getUnifiedDataReaderPool();
        if (!pool)
            pool = await initUnifiedDataReaderPool();
        if (pool) {
            const reader = new UnifiedDataReader(pool);
            const records = await reader.loadCallRecordsInWindow(tenantId, windowDays, region);
            return {
                mode,
                dataSources,
                db: new CallRecordsDbAdapter(records),
                region: region || undefined,
            };
        }
        Logger.warn('[federated] unified mode requested but PG pool unavailable — falling back to local');
    }
    if (mode === 'sqlite-fleet') {
        const records = await loadFleetMergedRecords(tenantId, windowDays);
        return { mode, dataSources, db: new CallRecordsDbAdapter(records), region: region || undefined };
    }
    if (mode === 'postgres-direct' || mode === 'local') {
        return { mode, dataSources, db: localDb, region: region || undefined };
    }
    return { mode: 'local', dataSources: ['history.db'], db: localDb, region: region || undefined };
}
export async function listFederatedRegions() {
    const pool = getUnifiedDataReaderPool() || (await initUnifiedDataReaderPool());
    if (!pool)
        return [];
    const reader = new UnifiedDataReader(pool);
    return reader.listRegions();
}
//# sourceMappingURL=federated-data-source.js.map