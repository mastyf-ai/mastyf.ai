import { CveFinding } from '../types.js';
export type NvdLookupStatus = 'ok' | 'degraded' | 'unavailable';
export interface NvdSearchResult {
    findings: CveFinding[];
    status: NvdLookupStatus;
    stale?: boolean;
}
/**
 * Client for NIST NVD API (https://services.nvd.nist.gov/rest/json/cves/2.0).
 * Requires an API key for production use (set via NVD_API_KEY env var).
 */
export declare class NvdClient {
    private baseUrl;
    private apiKey?;
    constructor(baseUrl?: string);
    /**
     * Search for CVEs by keyword (package name, product, etc.).
     * Returns up to 20 results.
     */
    search(keyword: string): Promise<NvdSearchResult>;
    private mapCvssSeverity;
}
//# sourceMappingURL=nvd-client.d.ts.map