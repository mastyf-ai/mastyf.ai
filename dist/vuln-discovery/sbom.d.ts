import type { McpServerConfig } from '../types.js';
export interface SbomComponent {
    name: string;
    version: string;
    purl?: string;
}
export interface SbomDocument {
    bomFormat: 'CycloneDX';
    specVersion: '1.5';
    serialNumber: string;
    version: number;
    metadata: {
        timestamp: string;
        component: {
            name: string;
            type: string;
        };
    };
    components: SbomComponent[];
}
/** Walk up from start looking for a lockfile; also check common install roots. */
export declare function findLockfileNear(startPath: string, maxUp?: number): string | null;
/** Infer install root from MCP server command/args (npx package path or local script). */
export declare function resolveServerPackageRoot(server: McpServerConfig): string | null;
export declare function buildSbomForServer(server: McpServerConfig): SbomDocument | null;
export declare function saveSbom(serverName: string, sbom: SbomDocument): string;
export declare function loadSbom(serverName: string): SbomDocument | null;
/** Diff previous vs current SBOM component sets — returns added/removed name@version. */
export declare function diffSbom(prev: SbomDocument | null, next: SbomDocument): {
    added: string[];
    removed: string[];
};
export declare function listSbomServerNames(): string[];
//# sourceMappingURL=sbom.d.ts.map