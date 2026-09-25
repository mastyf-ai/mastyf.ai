export function formatProRequiredMessage(_feature) {
    return 'All mastyf.ai features are MIT open source — no license key required.';
}
export async function ensureProFeature(_feature) {
    return;
}
export async function exitUnlessProFeature(_feature) {
    return;
}
export function assertProFeatureStarted(_feature) {
    return;
}
export class ProLicenseRequiredError extends Error {
    feature;
    constructor(feature) {
        super(`Feature unavailable: ${feature}`);
        this.name = 'ProLicenseRequiredError';
        this.feature = feature;
    }
}
/** CLI entry: node dist/license/check-pro.js <feature> — always succeeds. */
export async function runCheckProCli(_argv = process.argv.slice(2)) {
    return 0;
}
//# sourceMappingURL=enforce-pro.js.map