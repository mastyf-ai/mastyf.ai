import type { VulnFinding } from './types.js';
export interface UpstreamProbeResult {
    url: string;
    openApiFound: boolean;
    openApiUrl?: string;
    probesRun: number;
    findings: VulnFinding[];
    errors: string[];
}
/** Probe a single allowlisted upstream base URL. Read-only by default. */
export declare function probeUpstreamApi(baseUrl: string): Promise<UpstreamProbeResult>;
export declare function probeUpstreamApis(urls: string[]): Promise<UpstreamProbeResult[]>;
//# sourceMappingURL=upstream-api-prober.d.ts.map