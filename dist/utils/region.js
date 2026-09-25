/**
 * Multi-region labeling — active-passive failover; not active-active replication.
 */
export function getMastyfAiRegion() {
    return (process.env['MASTYF_AI_REGION'] ||
        process.env['AWS_REGION'] ||
        process.env['GCP_REGION'] ||
        'default');
}
export function getMastyfAiRegionLabels() {
    return { region: getMastyfAiRegion() };
}
//# sourceMappingURL=region.js.map