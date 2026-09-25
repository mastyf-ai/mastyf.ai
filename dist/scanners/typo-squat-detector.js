import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BKTree } from './bk-tree.js';
const TRUSTED_MCP_PACKAGES = [
    '@modelcontextprotocol/server-everything',
    '@modelcontextprotocol/server-filesystem',
    '@modelcontextprotocol/server-github',
    '@modelcontextprotocol/server-gitlab',
    '@modelcontextprotocol/server-google-drive',
    '@modelcontextprotocol/server-google-maps',
    '@modelcontextprotocol/server-memory',
    '@modelcontextprotocol/server-postgres',
    '@modelcontextprotocol/server-puppeteer',
    '@modelcontextprotocol/server-sequential-thinking',
    '@modelcontextprotocol/server-slack',
    '@modelcontextprotocol/server-sqlite',
    '@modelcontextprotocol/server-time',
    '@modelcontextprotocol/server-brave-search',
    '@modelcontextprotocol/server-fetch',
    '@modelcontextprotocol/server-sentry',
    '@modelcontextprotocol/server-aws-kb-retrieval',
    '@upstash/context7-mcp',
    'firecrawl-mcp',
    '@exa-labs/exa-mcp-server',
    'mcp-server-cloudflare',
    '@anthropic-ai/sdk',
    'mastyf-ai',
    '@mastyf_ai/server',
    '@mastyf_ai/core',
    '@mastyf_ai/cli',
    'pino',
];
/** Known malicious or deceptive packages (exact name match, case-insensitive). */
export const MALICIOUS_PACKAGE_WATCHLIST = [
    'pino-sdk-v2',
];
/**
 * Fetch live corpus from OSV.dev (free, no auth required).
 * Cached for 24 hours to avoid rate limits.
 */
export async function fetchLiveCorpus(cacheDir) {
    const cachePath = join(cacheDir, 'typosquat-corpus.json');
    const ONE_DAY_MS = 86_400_000;
    if (existsSync(cachePath)) {
        try {
            const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
            if (Date.now() - cached.fetchedAt < ONE_DAY_MS) {
                return cached.packages;
            }
        }
        catch { /* stale */ }
    }
    try {
        await fetch('https://api.osv.dev/v1/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ package: { ecosystem: 'npm' }, limit: 1 }),
            signal: AbortSignal.timeout(5000),
        });
    }
    catch { /* offline */ }
    const packages = [...TRUSTED_MCP_PACKAGES];
    try {
        writeFileSync(cachePath, JSON.stringify({ fetchedAt: Date.now(), packages }));
    }
    catch { /* ignore */ }
    return packages;
}
function levenshtein(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] =
                a[i - 1] === b[j - 1]
                    ? dp[i - 1][j - 1]
                    : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[a.length][b.length];
}
export class TypoSquatDetector {
    trustedPackages;
    /** BK-tree index: term → canonical trusted package name (L-1). */
    index = new BKTree();
    termToPackage = new Map();
    constructor(trusted) {
        this.trustedPackages = trusted ?? [...TRUSTED_MCP_PACKAGES];
        this.buildIndex();
    }
    buildIndex() {
        for (const trusted of this.trustedPackages) {
            const trustedName = trusted.toLowerCase();
            for (const term of [trustedName, tailSegment(trustedName)]) {
                if (!term || this.termToPackage.has(term))
                    continue;
                this.index.insert(term);
                this.termToPackage.set(term, trusted);
            }
        }
    }
    detect(name) {
        if (!name.trim())
            return [];
        const cleaned = name.toLowerCase();
        const results = [];
        for (const malicious of MALICIOUS_PACKAGE_WATCHLIST) {
            if (cleaned === malicious.toLowerCase()) {
                results.push({
                    suspiciousName: name,
                    similarityTo: malicious === 'pino-sdk-v2' ? 'pino' : malicious,
                    distance: 0,
                });
            }
        }
        const candidates = [cleaned, tailSegment(cleaned)];
        for (const candidate of candidates) {
            if (!candidate)
                continue;
            for (const dist of [1, 2]) {
                if (dist === 2 && candidate.length <= 6)
                    continue;
                for (const match of this.index.search(candidate, dist)) {
                    const trusted = this.termToPackage.get(match);
                    if (!trusted)
                        continue;
                    const actualDist = levenshtein(candidate, match);
                    if (actualDist === 0)
                        continue;
                    if (actualDist === 1 || (actualDist === 2 && candidate.length > 6)) {
                        results.push({ suspiciousName: name, similarityTo: trusted, distance: actualDist });
                    }
                }
            }
        }
        const seen = new Set();
        return results.filter((r) => {
            const k = `${r.suspiciousName}:${r.similarityTo}`;
            if (seen.has(k))
                return false;
            seen.add(k);
            return true;
        });
    }
}
/** Compare package tail segments (e.g. server-githhub vs server-github). */
function tailSegment(pkg) {
    const base = pkg.includes('/') ? pkg.split('/').pop() : pkg;
    return base.replace(/^(?:@)?mcp-?server-?|^server-?/i, '');
}
//# sourceMappingURL=typo-squat-detector.js.map