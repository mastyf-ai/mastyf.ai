import { TypoSquatResult } from '../types.js';

/**
 * Known official MCP server packages (subset of awesome-mcp-servers).
 * In production, this could be fetched from a registry.
 */
const OFFICIAL_PACKAGES: string[] = [
  '@modelcontextprotocol/server-filesystem',
  '@modelcontextprotocol/server-github',
  '@modelcontextprotocol/server-gitlab',
  '@modelcontextprotocol/server-postgres',
  '@modelcontextprotocol/server-sqlite',
  '@modelcontextprotocol/server-memory',
  '@modelcontextprotocol/server-puppeteer',
  '@modelcontextprotocol/server-brave-search',
  '@modelcontextprotocol/server-fetch',
  '@modelcontextprotocol/server-everything',
  '@modelcontextprotocol/server-sequential-thinking',
  '@modelcontextprotocol/server-time',
  'mcp-server-brave-search',
  'mcp-server-puppeteer',
  'mcp-server-filesystem',
  'server-filesystem',
  'server-github',
  'server-postgres',
  'server-sqlite',
  'server-memory',
  'server-puppeteer',
  'server-brave-search',
  'server-fetch',
  'server-sequential-thinking',
];

/**
 * Detects typo-squatting by comparing package names against known
 * official packages using Levenshtein distance.
 */
export class TypoSquatDetector {
  /**
   * Check a server name against known official packages.
   * Returns suspicious matches (Levenshtein distance 1-2).
   */
  detect(serverName: string): TypoSquatResult[] {
    if (!serverName) return [];

    const results: TypoSquatResult[] = [];
    const normalized = serverName.toLowerCase().trim();

    for (const official of OFFICIAL_PACKAGES) {
      const officialNorm = official.toLowerCase().trim();
      const distance = this.levenshteinDistance(normalized, officialNorm);

      // Flag very close matches (distance 1-2) that aren't exact matches
      if (distance > 0 && distance <= 2) {
        results.push({
          suspiciousName: serverName,
          similarityTo: official,
          distance,
        });
      }
    }

    return results;
  }

  private levenshteinDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;

    // Create two rows for memory efficiency
    let prev = new Array<number>(n + 1);
    let curr = new Array<number>(n + 1);

    for (let j = 0; j <= n; j++) {
      prev[j] = j;
    }

    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(
          prev[j] + 1,       // deletion
          curr[j - 1] + 1,   // insertion
          prev[j - 1] + cost // substitution
        );
      }
      [prev, curr] = [curr, prev];
    }

    return prev[n];
  }
}