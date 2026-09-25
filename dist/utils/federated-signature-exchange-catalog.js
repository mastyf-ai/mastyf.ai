export function buildSignatureHints(catalog, localIds, minInstances = 2) {
    const hints = [];
    for (const s of catalog.signatures) {
        if (s.instanceCount < minInstances)
            continue;
        const isNewLocally = !localIds.has(s.signatureId);
        hints.push({
            signatureId: s.signatureId,
            rule: s.rule,
            tool: s.tool,
            category: s.category,
            instanceCount: s.instanceCount,
            totalCount: s.eventCount,
            message: isNewLocally
                ? `${s.instanceCount} fleet instances saw ${s.tool}/${s.category} — not yet on this instance`
                : `${s.instanceCount} fleet instances also saw this pattern (${s.eventCount} events)`,
            firstSeen: s.lastSeen,
        });
    }
    return hints.sort((a, b) => b.totalCount - a.totalCount).slice(0, 50);
}
export function catalogFromFleetRows(rows) {
    return {
        signatures: rows.map((r) => ({
            signatureId: r.signature_id,
            rule: r.rule_name,
            tool: r.tool_name,
            category: r.category,
            argShapeHash: r.arg_shape_hash,
            instanceCount: r.instance_count,
            eventCount: r.event_count,
            lastSeen: String(r.last_seen),
        })),
    };
}
//# sourceMappingURL=federated-signature-exchange-catalog.js.map