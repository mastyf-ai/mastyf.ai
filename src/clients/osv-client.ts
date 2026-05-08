import axios from 'axios';
import { CveFinding } from '../types.js';
import { Logger } from '../utils/logger.js';

/**
 * Client for the OSV.dev API (https://api.osv.dev).
 * Queries known vulnerabilities for open-source packages.
 */
export class OsvClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'https://api.osv.dev/v1') {
    this.baseUrl = baseUrl;
  }

  /**
   * Check for known vulnerabilities in a package.
   * @param packageName - npm package name (e.g. '@modelcontextprotocol/sdk')
   * @param version - Optional version string
   * @returns Array of CVE findings
   */
  async check(packageName: string, version?: string): Promise<CveFinding[]> {
    try {
      // Normalize to purl-compatible format
      const purl = this.toPurl(packageName, version);
      const response = await axios.post(`${this.baseUrl}/query`, {
        package: { purl },
      }, {
        timeout: 10000,
      });
      const vulns: any[] = response.data?.vulns ?? [];
      return vulns.map((v: any) => ({
        id: v.id ?? 'unknown',
        severity: this.mapSeverity(v.severity),
        summary: v.summary ?? v.details?.substring(0, 200) ?? 'No description',
        fixedVersion: v.affected?.[0]?.ranges?.[0]?.events?.find((e: any) => e.fixed)?.fixed,
      }));
    } catch (error: any) {
      Logger.warn(`OSV lookup failed for ${packageName}: ${error?.message ?? 'Unknown error'}`);
      return [];
    }
  }

  private toPurl(packageName: string, version?: string): string {
    // npm purl: pkg:npm/package@version
    const encoded = encodeURIComponent(packageName);
    const versionSuffix = version ? `@${encodeURIComponent(version)}` : '';
    return `pkg:npm/${encoded}${versionSuffix}`;
  }

  private mapSeverity(severity?: string): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' {
    if (!severity) return 'MEDIUM';
    const map: Record<string, 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'> = {
      CRITICAL: 'CRITICAL',
      HIGH: 'HIGH',
      MODERATE: 'MEDIUM',
      LOW: 'LOW',
    };
    return map[severity.toUpperCase()] ?? 'MEDIUM';
  }
}