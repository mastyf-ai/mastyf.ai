/** Attach redaction metadata to MCP tool results (stdio JSON-RPC). */
export function injectRedactionMeta(result, reasons) {
    if (!reasons?.length || result == null || typeof result !== 'object')
        return result;
    const r = result;
    const prev = (r._meta && typeof r._meta === 'object' ? r._meta : {});
    return {
        ...r,
        _meta: {
            ...prev,
            redaction: { reasons: reasons.slice(0, 8) },
        },
    };
}
export function formatRedactionHeader(reasons) {
    if (!reasons?.length)
        return undefined;
    return reasons.slice(0, 5).join(', ');
}
//# sourceMappingURL=redaction-meta.js.map