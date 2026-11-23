/**
 * CMQ CLI Command Implementations.
 *
 * Provides `mastyf boundary` subcommands:
 * - inspect: Level 1 & Level 2 declarative and environmental checks
 * - test: Level 3 active canary escape tests
 * - qualify: Full evidence-bound Complete-Mediation Qualification with Ed25519 attestation
 * - report: Formats and verifies an existing signed attestation
 * - template: Generates dual-network Docker and K8s boundary templates
 */
export declare function handleBoundaryInspect(opts: {
    manifest?: string;
}): Promise<void>;
export declare function handleBoundaryTest(opts: {
    manifest?: string;
    canaryId?: string;
}): Promise<void>;
export declare function handleBoundaryQualify(opts: {
    manifest?: string;
    output?: string;
    json?: boolean;
    requireQualified?: boolean;
    continuous?: boolean;
    interval?: string | number;
}): Promise<void>;
export declare function handleBoundaryReport(opts: {
    cert?: string;
}): Promise<void>;
export declare function handleBoundaryTemplate(opts: {
    manifest?: string;
    type?: 'docker' | 'k8s' | 'all';
    outputDir?: string;
}): Promise<void>;
//# sourceMappingURL=cli-commands.d.ts.map