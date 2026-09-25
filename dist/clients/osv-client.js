import axios from 'axios';
import { Logger } from '../utils/logger.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { readCveDiskCache, writeCveDiskCache, isCveCacheFresh, getCveCacheTtlMs, } from '../utils/cve-api-disk-cache.js';
const osvLimiter = new RateLimiter({ tokensPerInterval: 10, interval: 60_000 });
const CACHE_PREFIX = 'osv:';
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
            await new Promise((r) => setTimeout(r, 500 * (i + 1)));
        }
    }
    throw lastErr;
}
/**
 * Client for the OSV.dev API (https://api.osv.dev).
 * Queries known vulnerabilities for open-source packages.
 */
export class OsvClient {
    baseUrl;
    constructor(baseUrl = 'https://api.osv.dev/v1') {
        this.baseUrl = baseUrl;
    }
    /**
     * Check for known vulnerabilities in a package.
     * @param packageName - npm package name (e.g. '@modelcontextprotocol/sdk')
     * @param version - Optional version string
     * @returns Array of CVE findings
     */
    async check(packageName, version) {
        const cacheKey = `${CACHE_PREFIX}${packageName}@${version ?? 'latest'}`;
        const disk = readCveDiskCache(cacheKey);
        if (disk && isCveCacheFresh(disk)) {
            return disk.data;
        }
        try {
            const response = await withRetry(async () => {
                await osvLimiter.acquire();
                const purl = this.toPurl(packageName, version);
                return axios.post(`${this.baseUrl}/query`, { package: { purl } }, { timeout: 10000 });
            });
            const vulns = (response.data?.vulns ?? []);
            const result = {
                status: 'ok',
                findings: vulns.map((v) => ({
                    id: String(v.id ?? 'unknown'),
                    severity: this.mapSeverity(v.severity),
                    summary: String(v.summary ?? v.details?.substring(0, 200) ?? 'No description'),
                    fixedVersion: v.affected?.[0]
                        ?.ranges?.[0]?.events?.find((e) => e.fixed)?.fixed,
                    source: 'osv',
                })),
            };
            writeCveDiskCache(cacheKey, result);
            return result;
        }
        catch (error) {
            const status = error?.response?.status;
            const msg = error instanceof Error ? error.message : String(error);
            Logger.warn(`OSV lookup failed for ${packageName}: ${msg}`);
            const failStatus = status === 403 || status === 429 ? 'unavailable' : 'degraded';
            if (disk) {
                return { ...disk.data, status: failStatus === 'unavailable' ? 'unavailable' : 'degraded', stale: true };
            }
            return { findings: [], status: failStatus };
        }
    }
    /**
     * Construct a Package URL (purl).
     * Defaults to npm ecosystem; set ecosystem to 'pypi' for Python/uvx packages.
     */
    toPurl(packageName, version, ecosystem = 'npm') {
        const encoded = encodeURIComponent(packageName);
        const versionSuffix = version ? `@${encodeURIComponent(version)}` : '';
        return `pkg:${ecosystem}/${encoded}${versionSuffix}`;
    }
    /**
     * Detect the correct package ecosystem from the MCP server command.
     * 'uvx' and 'python -m' indicate a Python/PyPI package.
     */
    static detectEcosystem(command, args) {
        if (!command)
            return 'npm';
        const cmd = command.toLowerCase();
        if (cmd === 'uvx' || cmd === 'uv' || cmd.includes('python'))
            return 'pypi';
        // Check args for uvx/python patterns
        if (args && args.length > 0) {
            const joined = args.join(' ').toLowerCase();
            if (joined.includes('uvx ') || joined.includes('python -m'))
                return 'pypi';
        }
        return 'npm';
    }
    /** Check with explicit ecosystem (for Python/uvx MCP servers). */
    async checkEcosystem(packageName, ecosystem, version) {
        const cacheKey = `${CACHE_PREFIX}${ecosystem}:${packageName}@${version ?? 'latest'}`;
        const disk = readCveDiskCache(cacheKey);
        if (disk && isCveCacheFresh(disk, getCveCacheTtlMs())) {
            return disk.data;
        }
        try {
            const response = await withRetry(async () => {
                await osvLimiter.acquire();
                const purl = this.toPurl(packageName, version, ecosystem);
                return axios.post(`${this.baseUrl}/query`, { package: { purl } }, { timeout: 10000 });
            });
            const vulns = (response.data?.vulns ?? []);
            const result = {
                status: 'ok',
                findings: vulns.map((v) => ({
                    id: String(v.id ?? 'unknown'),
                    severity: this.mapSeverity(v.severity),
                    summary: String(v.summary ?? v.details?.substring(0, 200) ?? 'No description'),
                    fixedVersion: v.affected?.[0]
                        ?.ranges?.[0]?.events?.find((e) => e.fixed)?.fixed,
                    source: 'osv',
                })),
            };
            writeCveDiskCache(cacheKey, result);
            return result;
        }
        catch (error) {
            const status = error?.response?.status;
            const msg = error instanceof Error ? error.message : String(error);
            Logger.warn(`OSV lookup failed for ${packageName} (${ecosystem}): ${msg}`);
            const failStatus = status === 403 || status === 429 ? 'unavailable' : 'degraded';
            if (disk) {
                return { ...disk.data, status: failStatus, stale: true };
            }
            return { findings: [], status: failStatus };
        }
    }
    mapSeverity(severity) {
        const label = this.normalizeSeverityLabel(severity);
        if (!label)
            return 'MEDIUM';
        const map = {
            CRITICAL: 'CRITICAL',
            HIGH: 'HIGH',
            MODERATE: 'MEDIUM',
            MEDIUM: 'MEDIUM',
            LOW: 'LOW',
        };
        return map[label] ?? 'MEDIUM';
    }
    /** OSV may return severity as a string or as [{ type, score }]. */
    normalizeSeverityLabel(severity) {
        if (typeof severity === 'string')
            return severity.toUpperCase();
        if (Array.isArray(severity) && severity.length > 0) {
            const first = severity[0];
            if (typeof first === 'string')
                return first.toUpperCase();
            if (first && typeof first === 'object') {
                const score = first.score;
                if (typeof score === 'string') {
                    const m = score.match(/CRITICAL|HIGH|MEDIUM|LOW|MODERATE/i);
                    if (m)
                        return m[0].toUpperCase();
                    const num = parseFloat(score);
                    if (!Number.isNaN(num)) {
                        if (num >= 9)
                            return 'CRITICAL';
                        if (num >= 7)
                            return 'HIGH';
                        if (num >= 4)
                            return 'MEDIUM';
                        return 'LOW';
                    }
                }
            }
        }
        if (severity && typeof severity === 'object' && !Array.isArray(severity)) {
            const s = severity.score
                ?? severity.type;
            if (typeof s === 'string')
                return this.normalizeSeverityLabel(s);
        }
        return null;
    }
}
//# sourceMappingURL=osv-client.js.map