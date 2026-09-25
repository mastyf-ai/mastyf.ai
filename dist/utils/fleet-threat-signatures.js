/**
 * Fleet threat signatures — anonymized attack shape aggregation for control-plane sync.
 * No raw payloads; only rule + tool + category + arg-shape hash.
 */
import { createHash } from 'crypto';
function hashSignature(parts) {
    return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 16);
}
export function argShapeFromKeys(keys) {
    const sorted = [...keys].sort();
    return createHash('sha256').update(sorted.join('|')).digest('hex').slice(0, 12);
}
export function buildThreatSignature(input, count = 1) {
    const category = input.category || 'unknown';
    const argShapeHash = argShapeFromKeys(input.argKeys || []);
    const signatureId = hashSignature([input.rule, input.tool, category, argShapeHash]);
    return {
        signatureId,
        rule: input.rule,
        tool: input.tool,
        category,
        argShapeHash,
        count,
        lastSeen: new Date().toISOString(),
        region: input.region,
    };
}
export function mergeThreatSignatures(existing, incoming) {
    const byId = new Map();
    for (const s of existing)
        byId.set(s.signatureId, { ...s });
    for (const s of incoming) {
        const prev = byId.get(s.signatureId);
        if (prev) {
            byId.set(s.signatureId, {
                ...prev,
                count: prev.count + s.count,
                lastSeen: s.lastSeen > prev.lastSeen ? s.lastSeen : prev.lastSeen,
            });
        }
        else {
            byId.set(s.signatureId, { ...s });
        }
    }
    return [...byId.values()].sort((a, b) => b.count - a.count);
}
export function aggregateThreatSignaturesFromBlocks(blocks, region) {
    const counts = new Map();
    for (const b of blocks) {
        const rule = b.rule || 'unknown';
        const tool = b.tool || 'unknown';
        const input = {
            rule,
            tool,
            category: b.category,
            argKeys: b.argKeys,
            region,
        };
        const sig = buildThreatSignature(input, 0);
        const cur = counts.get(sig.signatureId) || { input, count: 0 };
        cur.count += 1;
        counts.set(sig.signatureId, cur);
    }
    return [...counts.values()].map(({ input, count }) => buildThreatSignature(input, count));
}
export async function collectHeartbeatThreatSignatures() {
    const { loadSemanticAuditRecordsAsync } = await import('../ai/semantic-audit-store.js');
    const { getMastyfAiRegion } = await import('./region.js');
    const records = await loadSemanticAuditRecordsAsync({
        sinceMs: 60 * 60 * 1000,
        limit: 100,
    });
    const blocks = records
        .filter((r) => r.syncDecision?.action === 'block' || r.semanticAudit?.suspicious)
        .map((r) => ({
        rule: r.syncDecision?.rule || 'semantic-flag',
        tool: r.toolName,
        category: r.semanticAudit?.categories?.[0] || 'unknown',
        argKeys: [],
    }));
    return aggregateThreatSignaturesFromBlocks(blocks, getMastyfAiRegion());
}
/** Alert when the same signature appears in 3+ regions within the window. */
export function detectCrossRegionThreatAlerts(byRegion, minRegions = 3) {
    const sigRegions = new Map();
    for (const [region, sigs] of byRegion) {
        for (const s of sigs) {
            const cur = sigRegions.get(s.signatureId) || { regions: new Set(), total: 0 };
            cur.regions.add(region);
            cur.total += s.count;
            sigRegions.set(s.signatureId, cur);
        }
    }
    const alerts = [];
    for (const [signatureId, data] of sigRegions) {
        if (data.regions.size >= minRegions) {
            alerts.push({
                signatureId,
                regionCount: data.regions.size,
                totalCount: data.total,
                message: `Signature ${signatureId} seen in ${data.regions.size} regions (${data.total} events)`,
            });
        }
    }
    return alerts.sort((a, b) => b.totalCount - a.totalCount);
}
//# sourceMappingURL=fleet-threat-signatures.js.map