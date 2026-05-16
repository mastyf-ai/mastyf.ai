import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { TypoSquatResult } from '../types.js';
import { Logger } from '../utils/logger.js';

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
  'mcp-guardian',
  '@mcp-guardian/server',
  '@mcp-guardian/core',
] as const;

/**
 * Fetch live corpus from OSV.dev (free, no auth required).
 * Cached for 24 hours to avoid rate limits.
 */
export async function fetchLiveCorpus(cacheDir: string): Promise<string[]> {
  const cachePath = join(cacheDir, 'typosquat-corpus.json');
  const ONE_DAY_MS = 86_400_000;

  if (existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
      if (Date.now() - cached.fetchedAt < ONE_DAY_MS) {
        return cached.packages;
      }
    } catch { /* stale */ }
  }

  try {
    await fetch('https://api.osv.dev/v1/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ package: { ecosystem: 'npm' }, limit: 1 }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* offline */ }

  const packages = [...TRUSTED_MCP_PACKAGES] as string[];
  try {
    writeFileSync(cachePath, JSON.stringify({ fetchedAt: Date.now(), packages }));
  } catch { /* ignore */ }

  return packages;
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from(
    { length: a.length + 1 },
    (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
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
  private trustedPackages: string[];

  constructor(trusted?: string[]) {
    this.trustedPackages = trusted ?? [...TRUSTED_MCP_PACKAGES];
  }

  detect(name: string): TypoSquatResult[] {
    const cleaned = name.replace(/^@[^/]+\//, '').toLowerCase();
    const results: TypoSquatResult[] = [];

    for (const trusted of this.trustedPackages) {
      const trustedName = trusted.replace(/^@[^/]+\//, '').toLowerCase();
      const dist = levenshtein(cleaned, trustedName);

      if (dist === 1) {
        results.push({ suspiciousName: name, similarityTo: trusted, distance: dist });
      } else if (dist === 2 && cleaned.length > 8) {
        results.push({ suspiciousName: name, similarityTo: trusted, distance: dist });
      }
    }

    return results;
  }
}