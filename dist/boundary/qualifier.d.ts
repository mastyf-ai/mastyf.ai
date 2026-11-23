/**
 * CMQ Qualifier Engine.
 *
 * Runs the end-to-end Complete-Mediation Qualification process across three levels of evidence:
 * LEVEL 1 (Declarative): Manifest isolation and fail-closed architecture
 * LEVEL 2 (Environmental): Runtime inspection, credential isolation, and active direct-socket probing
 * LEVEL 3 (Adversarial): Canary escape harness executing 15 active evasion vectors
 *
 * Produces a cryptographically signed Evidence Package (Ed25519) binding environment,
 * configuration hashes, inspection metrics, and test results.
 */
import { BoundaryManifest, CMQAttestationReport } from './types.js';
export declare function runCompleteMediationQualification(manifest: BoundaryManifest, opts?: {
    canaryId?: string;
    agentEnv?: NodeJS.ProcessEnv;
}): Promise<CMQAttestationReport>;
export declare function formatTerminalReport(report: CMQAttestationReport): string;
//# sourceMappingURL=qualifier.d.ts.map