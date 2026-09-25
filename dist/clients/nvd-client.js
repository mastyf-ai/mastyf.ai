import axios from 'axios';
import { Logger } from '../utils/logger.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { readCveDiskCache, writeCveDiskCache, isCveCacheFresh, } from '../utils/cve-api-disk-cache.js';
const CACHE_PREFIX = 'nvd:';
const nvdLimiter = new RateLimiter({ tokensPerInterval: 5, interval: 60_000 });
const nvdApiKeyLimiter = new RateLimiter({ tokensPerInterval: 30, interval: 60_000 });
async function withRetry(fn, retries = 2) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        try {
            return await fn();
        }
        catch (err) {
            lastErr = err;
            const status = err?.response?.status;
            if (status !== 403 && status !== 429)
                throw err;
            await new Promise((r) => setTimeout(r, 800 * (i + 1)));
        }
    }
    throw lastErr;
}
/**
 * Client for NIST NVD API (https://services.nvd.nist.gov/rest/json/cves/2.0).
 * Requires an API key for production use (set via NVD_API_KEY env var).
 */
export class NvdClient {
    baseUrl;
    apiKey;
    constructor(baseUrl = 'https://services.nvd.nist.gov/rest/json/cves/2.0') {
        this.baseUrl = baseUrl;
        this.apiKey = process.env['NVD_API_KEY'];
    }
    /**
     * Search for CVEs by keyword (package name, product, etc.).
     * Returns up to 20 results.
     */
    async search(keyword) {
        const cacheKey = `${CACHE_PREFIX}${keyword}`;
        const disk = readCveDiskCache(cacheKey);
        if (disk && isCveCacheFresh(disk)) {
            return disk.data;
        }
        try {
            const response = await withRetry(async () => {
                const params = {
                    keywordSearch: keyword,
                    resultsPerPage: '20',
                };
                const headers = {};
                if (this.apiKey)
                    headers['apiKey'] = this.apiKey;
                const limiter = this.apiKey ? nvdApiKeyLimiter : nvdLimiter;
                await limiter.acquire();
                return axios.get(this.baseUrl, { params, headers, timeout: 15000 });
            });
            const vulnerabilities = response.data?.vulnerabilities ?? [];
            const result = {
                status: 'ok',
                findings: vulnerabilities.map((entry) => {
                    const cve = entry.cve ?? {};
                    const metrics = cve.metrics
                        ?.cvssMetricV31?.[0]?.cvssData
                        ?? cve.metrics
                            ?.cvssMetricV30?.[0]?.cvssData;
                    const descriptions = cve.descriptions;
                    return {
                        id: String(cve.id ?? 'unknown'),
                        severity: this.mapCvssSeverity(metrics?.baseSeverity ?? 'MEDIUM'),
                        summary: descriptions?.[0]?.value?.substring(0, 200) ?? 'No description',
                        fixedVersion: undefined,
                        source: 'nvd',
                    };
                }),
            };
            writeCveDiskCache(cacheKey, result);
            return result;
        }
        catch (error) {
            const status = error?.response?.status;
            const msg = error instanceof Error ? error.message : String(error);
            Logger.warn(`NVD search failed for "${keyword}": ${msg}`);
            const failStatus = status === 403 || status === 429 ? 'unavailable' : 'degraded';
            if (disk) {
                return { ...disk.data, status: failStatus, stale: true };
            }
            return { findings: [], status: failStatus };
        }
    }
    mapCvssSeverity(severity) {
        const upper = severity.toUpperCase();
        if (upper === 'CRITICAL')
            return 'CRITICAL';
        if (upper === 'HIGH')
            return 'HIGH';
        if (upper === 'LOW')
            return 'LOW';
        return 'MEDIUM';
    }
}
//# sourceMappingURL=nvd-client.js.map