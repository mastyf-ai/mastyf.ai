/**
 * Legacy license gate — removed. All features are MIT open source.
 */
import type { ProFeature } from './feature-tiers.js';
export declare function formatProRequiredMessage(_feature: string): string;
export declare function ensureProFeature(_feature: ProFeature | string): Promise<void>;
export declare function exitUnlessProFeature(_feature: ProFeature | string): Promise<void>;
export declare function assertProFeatureStarted(_feature: ProFeature | string): void;
export declare class ProLicenseRequiredError extends Error {
    readonly feature: string;
    constructor(feature: string);
}
/** CLI entry: node dist/license/check-pro.js <feature> — always succeeds. */
export declare function runCheckProCli(_argv?: string[]): Promise<number>;
//# sourceMappingURL=enforce-pro.d.ts.map