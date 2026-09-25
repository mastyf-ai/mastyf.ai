import { buildChartMeta } from './chart-meta.js';
import { parseRecordTimestamp, parseWindowDays } from './time-buckets.js';
export function buildAuditHeatmap(records, maxCells = 100) {
    const map = new Map();
    for (const r of records) {
        if (!r.blocked)
            continue;
        const rule = r.blockRule || 'unknown';
        const tool = r.toolName || 'unknown';
        const key = `${rule}\0${tool}`;
        map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()]
        .map(([key, count]) => {
        const [rule, tool] = key.split('\0');
        return { rule, tool, count };
    })
        .sort((a, b) => b.count - a.count)
        .slice(0, maxCells);
}
export function buildAuditActivityMatrix(records) {
    const dayHour = new Map();
    let maxCount = 0;
    for (const r of records) {
        const ts = parseRecordTimestamp(r.timestamp);
        if (!Number.isFinite(ts))
            continue;
        const d = new Date(ts);
        const day = d.toISOString().slice(0, 10);
        const hour = d.getUTCHours();
        const key = `${day}\0${hour}`;
        const count = (dayHour.get(key) || 0) + 1;
        dayHour.set(key, count);
        if (count > maxCount)
            maxCount = count;
    }
    const days = [...new Set([...dayHour.keys()].map((k) => k.split('\0')[0]))].sort();
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const matrix = days.map((day) => hours.map((hour) => dayHour.get(`${day}\0${hour}`) || 0));
    return { days, hours, matrix, maxCount };
}
export function buildAuditHeatmapBundle(records, windowDaysInput = 7) {
    const windowDays = parseWindowDays(windowDaysInput);
    const cells = buildAuditHeatmap(records);
    const activity = buildAuditActivityMatrix(records);
    const meta = buildChartMeta({
        windowDays,
        recordCount: records.length,
        sparse: records.length > 0 && activity.maxCount <= 1,
        dataSources: ['history.db'],
        emptyReason: records.length === 0 ? 'No audit events in selected window' : undefined,
    });
    return { windowDays, cells, activity, meta };
}
//# sourceMappingURL=audit-heatmap.js.map