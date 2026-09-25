import type { VulnFinding, VulnSeverity, VulnStatus } from './types.js';
export declare function fingerprintFinding(partial: {
    class: string;
    target: {
        kind: string;
        name: string;
        version?: string;
        url?: string;
    };
    title: string;
    evidence: {
        scanner: string;
        reproSteps: string[];
    };
}): string;
export declare function createFindingId(fingerprint: string): string;
export declare function loadFindings(): VulnFinding[];
export declare function getFinding(id: string): VulnFinding | undefined;
export declare function upsertFinding(finding: VulnFinding): VulnFinding;
export declare function updateFindingStatus(id: string, status: VulnStatus, extra?: Partial<VulnFinding>): VulnFinding | undefined;
export declare function listFindings(opts?: {
    status?: VulnStatus;
    minSeverity?: VulnSeverity;
    class?: string;
}): VulnFinding[];
/** Compact store by rewriting unique latest records (maintenance). */
export declare function compactFindingsStore(): number;
//# sourceMappingURL=store.d.ts.map