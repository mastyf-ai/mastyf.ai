import axios from 'axios';
import { CveFinding } from '../types.js';
import { Logger } from '../utils/logger.js';
import { nvdLimiter, nvdApiKeyLimiter } from '../utils/rate-limiter.js';

/**
 * Client for NIST NVD API (https://services.nvd.nist.gov/rest/json/cves/2.0).
 * Requires an API key for production use (set via NVD_API_KEY env var).
 */
export class NvdClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor(baseUrl: string = 'https://services.nvd.nist.gov/rest/json/cves/2.0') {
    this.baseUrl = baseUrl;
    this.apiKey = process.env['NVD_API_KEY'];
  }

  /**
   * Search for CVEs by keyword (package name, product, etc.).
   * Returns up to 20 results.
   */
  async search(keyword: string): Promise<CveFinding[]> {
    try {
      const params: Record<string, string> = {
        keywordSearch: keyword,
        resultsPerPage: '20',
      };
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['apiKey'] = this.apiKey;
      }

      const limiter = this.apiKey ? nvdApiKeyLimiter : nvdLimiter;
      await limiter.acquire();

      const response = await axios.get(this.baseUrl, {
        params,
        headers,
        timeout: 15000,
      });

      const vulnerabilities = response.data?.vulnerabilities ?? [];
      return vulnerabilities.map((entry: any) => {
        const cve = entry.cve ?? {};
        const metrics = cve.metrics?.cvssMetricV31?.[0]?.cvssData ?? cve.metrics?.cvssMetricV30?.[0]?.cvssData;
        return {
          id: cve.id ?? 'unknown',
          severity: this.mapCvssSeverity(metrics?.baseSeverity ?? 'MEDIUM'),
          summary: cve.descriptions?.[0]?.value?.substring(0, 200) ?? 'No description',
          fixedVersion: undefined,
        };
      });
    } catch (error: any) {
      Logger.warn(`NVD search failed for "${keyword}": ${error?.message ?? 'Unknown error'}`);
      return [];
    }
  }

  private mapCvssSeverity(severity: string): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' {
    const upper = severity.toUpperCase();
    if (upper === 'CRITICAL') return 'CRITICAL';
    if (upper === 'HIGH') return 'HIGH';
    if (upper === 'LOW') return 'LOW';
    return 'MEDIUM';
  }
}