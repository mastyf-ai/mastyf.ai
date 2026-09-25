/**
 * Block tool calls when server certification does not meet policy requirement.
 */
import type { PolicyStrategy } from './types.js';
export type CertLevel = 'bronze' | 'silver' | 'gold' | 'platinum';
export declare function certLevelMeets(actual: CertLevel, required: CertLevel): boolean;
export declare function parseCertLevel(raw: unknown): CertLevel | null;
export declare const certificationStrategy: PolicyStrategy;
//# sourceMappingURL=certification-strategy.d.ts.map