/**
 * MCP Mastyf AI Plugin SDK v4.0 — detector plugins + industry-standard hooks.
 * @see docs/PLUGIN_SDK.md
 */
export type DetectorSeverity = 'HIGH' | 'MEDIUM' | 'high' | 'medium';
export interface DetectorScanContext {
    serverName?: string;
    toolName?: string;
    location?: string;
}
export interface DetectorFinding {
    type: string;
    location: string;
    severity: DetectorSeverity;
    redacted?: string;
    context?: string;
    method?: 'regex' | 'heuristic' | 'llm' | string;
}
export interface DetectorPluginLifecycle {
    onLoad?(): void | Promise<void>;
    onUnload?(): void | Promise<void>;
}
export interface DetectorPlugin extends DetectorPluginLifecycle {
    name: string;
    version?: string;
    scanArguments(text: string, ctx: DetectorScanContext): DetectorFinding[] | Promise<DetectorFinding[]>;
}
export interface CreatePluginOptions {
    name: string;
    version?: string;
    scanArguments: DetectorPlugin['scanArguments'];
    onLoad?: DetectorPluginLifecycle['onLoad'];
    onUnload?: DetectorPluginLifecycle['onUnload'];
}
export declare function createDetectorPlugin(opts: CreatePluginOptions): DetectorPlugin;
export declare const PLUGIN_SDK_VERSION = "4.1.1";
/** Build MTX v1 record JSON for threat mesh contribution from a plugin finding. */
export declare function exportMtxRecord(params: {
    toolName: string;
    argFingerprint: string;
    category: string;
    blockReason: string;
}): string;
export interface CertSubmitPayload {
    serverName: string;
    packageName: string;
    version: string;
    level: string;
    attestationJws: string;
}
/** POST certification attestation to Mastyf AI cloud registry (or custom URL). */
export declare function submitCertificationAttestation(payload: CertSubmitPayload, registryUrl?: string, apiKey?: string): Promise<{
    ok: boolean;
    status: number;
    body?: unknown;
}>;
//# sourceMappingURL=index.d.ts.map