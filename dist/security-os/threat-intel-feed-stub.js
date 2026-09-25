/**
 * Stub lookup: if disabled → DISABLED; if enabled but no reachable feed → UNAVAILABLE (fail-closed).
 * Does not call network in this stub — returns UNAVAILABLE when enabled so callers cannot treat silence as clean.
 */
export function lookupPoisonedPackageStub(packageId, config) {
    if (!config.enabled) {
        return {
            status: 'DISABLED',
            source_label: 'third-party',
            package_id: packageId,
            matched: false,
            reason: 'third-party threat intel feed disabled',
            signals: [],
        };
    }
    if (!config.feedUrl) {
        return {
            status: 'UNAVAILABLE',
            source_label: 'third-party',
            package_id: packageId,
            matched: false,
            reason: 'feed enabled but feed_url missing — fail-closed (no fabricated clean result)',
            signals: [],
        };
    }
    // Network client intentionally not implemented in stub wave.
    return {
        status: 'UNAVAILABLE',
        source_label: 'third-party',
        package_id: packageId,
        matched: false,
        reason: 'third-party feed client not configured — fail-closed',
        signals: [],
    };
}
//# sourceMappingURL=threat-intel-feed-stub.js.map