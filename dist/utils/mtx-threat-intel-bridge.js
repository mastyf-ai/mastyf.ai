let mtxProvider = null;
export function setMtxPatternProvider(provider) {
    mtxProvider = provider;
}
export function clearMtxPatternProvider() {
    mtxProvider = null;
}
export function loadMtxPatternsFromStore(store, tenantId = 'default') {
    return store.listMtxPatternHashes(tenantId, 2000);
}
export function getMtxThreatPatterns() {
    if (!mtxProvider)
        return [];
    try {
        return mtxProvider();
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=mtx-threat-intel-bridge.js.map