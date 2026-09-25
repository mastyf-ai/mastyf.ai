import { CveFinding } from '../types.js';
export type CveLookupStatus = 'ok' | 'degraded' | 'unavailable';
export interface OsvCheckResult {
    findings: CveFinding[];
    status: CveLookupStatus;
    /** True when served from disk cache after live API failure */
    stale?: boolean;
}
/**
 * Client for the OSV.dev API (https://api.osv.dev).
 * Queries known vulnerabilities for open-source packages.
 */
export declare class OsvClient {
    private baseUrl;
    constructor(baseUrl?: string);
    /**
     * Check for known vulnerabilities in a package.
     * @param packageName - npm package name (e.g. '@modelcontextprotocol/sdk')
     * @param version - Optional version string
     * @returns Array of CVE findings
     */
    check(packageName: string, version?: string): Promise<OsvCheckResult>;
    /**
     * Construct a Package URL (purl).
     * Defaults to npm ecosystem; set ecosystem to 'pypi' for Python/uvx packages.
     */
    private toPurl;
    /**
     * Detect the correct package ecosystem from the MCP server command.
     * 'uvx' and 'python -m' indicate a Python/PyPI package.
     */
    static detectEcosystem(command?: string, args?: string[]): 'npm' | 'pypi';
    /** Check with explicit ecosystem (for Python/uvx MCP servers). */
    checkEcosystem(packageName: string, ecosystem: 'npm' | 'pypi', version?: string): Promise<OsvCheckResult>;
    private mapSeverity;
    /** OSV may return severity as a string or as [{ type, score }]. */
    private normalizeSeverityLabel;
}
//# sourceMappingURL=osv-client.d.ts.map