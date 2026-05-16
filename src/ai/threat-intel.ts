import { PolicyRule, PolicyAction } from '../policy/policy-types.js';
import { Logger } from '../utils/logger.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

export interface ThreatIntelEntry {
  id: string;
  source: 'OSV' | 'NVD' | 'GitHub' | 'custom';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  affectedPackage?: string;
  affectedPattern?: string;
  signature?: string;
  description: string;
  remediation: string;
  publishedAt: string;
}

export interface ThreatSuggestion {
  rule: PolicyRule;
  confidence: number;
  reason: string;
  source: 'threat';
  entry: ThreatIntelEntry;
}

/**
 * Threat intelligence integration — ingests MCP-specific threat feeds and
 * auto-generates blocking policy rules based on severity and applicability.
 * Maintains a last-seen state to only process new entries on each fetch.
 */
export class ThreatIntel {
  private lastSeenIds: Set<string> = new Set();
  private statePath: string;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private liveFeedSources: string[] = [];
  private nvdApiKey: string;

  constructor(statePath?: string) {
    this.statePath = statePath || join(dirname(new URL(import.meta.url).pathname), '..', '..', '.threat-state.json');
    this.nvdApiKey = process.env['NVD_API_KEY'] || '';
    this.loadState();
  }

  /** Start periodic polling of live threat feeds (NVD, OSV, GitHub) */
  startLivePolling(intervalMs: number = 30 * 60 * 1000): void {
    if (this.pollTimer) return;
    Logger.info(`[ThreatIntel] Starting live feed polling every ${intervalMs / 1000}s`);
    this.pollTimer = setInterval(() => {
      this.pollLiveFeeds().catch(err => {
        Logger.warn(`[ThreatIntel] Live feed poll failed: ${err?.message}`);
      });
    }, intervalMs);
    // Initial poll
    this.pollLiveFeeds().catch(() => {});
  }

  /** Stop live polling */
  stopLivePolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Poll all live threat feed sources */
  async pollLiveFeeds(): Promise<ThreatIntelEntry[]> {
    const results = await Promise.allSettled([
      this.pollNvdFeed(),
      this.pollOsvFeed(),
      this.pollGitHubFeed(),
    ]);

    const allEntries: ThreatIntelEntry[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allEntries.push(...result.value);
      }
    }

    if (allEntries.length > 0) {
      const newEntries = this.diffFeed(allEntries);
      Logger.info(`[ThreatIntel] Live poll: ${allEntries.length} total, ${newEntries.length} new threats`);
      return newEntries;
    }

    return [];
  }

  /** Poll NVD API v2 for recent CVEs relevant to MCP ecosystem */
  private async pollNvdFeed(): Promise<ThreatIntelEntry[]> {
    try {
      const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      // Search for MCP-relevant keywords
      const keywords = ['model context protocol', 'mcp server', 'prompt injection', 'LLM', 'tool calling'];
      const entries: ThreatIntelEntry[] = [];

      for (const keyword of keywords) {
        const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(keyword)}&pubStartDate=${lastWeek}&resultsPerPage=10`;
        const headers: Record<string, string> = {};
        if (this.nvdApiKey) headers['apiKey'] = this.nvdApiKey;

        const response = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) continue;
        const data = await response.json() as any;
        const vulns = data?.vulnerabilities || [];

        for (const vuln of vulns) {
          const cve = vuln.cve;
          if (!cve?.id) continue;

          const severity = cve.metrics?.cvssMetricV31?.[0]?.cvssData?.baseSeverity ||
            cve.metrics?.cvssMetricV30?.[0]?.cvssData?.baseSeverity || 'MEDIUM';

          const desc = cve.descriptions?.find((d: any) => d.lang === 'en')?.value || 'No description';

          entries.push({
            id: `nvd-${cve.id}`,
            source: 'NVD',
            severity: severity.toUpperCase(),
            affectedPackage: cve.id,
            description: desc.slice(0, 500),
            remediation: 'Update affected packages to patched versions',
            publishedAt: cve.published || new Date().toISOString(),
            // cve.id is already in CVE-YYYY-NNNN format; no need to prepend
            signature: cve.id,
          });
        }
      }

      return entries;
    } catch (err: any) {
      Logger.debug(`[ThreatIntel] NVD poll error: ${err?.message}`);
      return [];
    }
  }

  /** Poll OSV.dev API for MCP ecosystem vulnerabilities */
  private async pollOsvFeed(): Promise<ThreatIntelEntry[]> {
    try {
      // Query OSV.dev for common MCP-related packages
      const packages = ['@modelcontextprotocol/sdk', 'mcp-server', 'mcp-guardian'];
      const entries: ThreatIntelEntry[] = [];

      for (const pkg of packages) {
        const response = await fetch('https://api.osv.dev/v1/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ package: { name: pkg, ecosystem: 'npm' } }),
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) continue;
        const data = await response.json() as any;
        const vulns = data?.vulns || [];

        for (const vuln of vulns) {
          // OSV severity[].score is a CVSS vector string, not a number.
          // Extract numeric score from database_specific or compute from the vector.
          const cvssSev = vuln.severity?.find((s: any) => s.type === 'CVSS_V3');
          let numericScore: number | null = null;
          if (cvssSev) {
            // Try numeric score from database_specific first
            const dbScore = parseFloat(cvssSev.database_specific?.cvss?.score);
            if (!isNaN(dbScore)) {
              numericScore = dbScore;
            } else {
              // Parse CVSS vector string for base score if present
              const scoreMatch = cvssSev.score?.match?.(/^CVSS:3\.\d\/(?:[^/]*\/)*?AV:[NALP]\/(?:[^/]*\/)*?AC:[LH]\/.*$/);
              // Fallback: try direct parseFloat — if it's NaN, score stays null
              const parsed = parseFloat(cvssSev.score);
              numericScore = isNaN(parsed) ? null : parsed;
            }
          }
          const severity = numericScore !== null
            ? (numericScore >= 9 ? 'CRITICAL' :
               numericScore >= 7 ? 'HIGH' :
               numericScore >= 4 ? 'MEDIUM' : 'LOW')
            : 'MEDIUM';

          entries.push({
            id: `osv-${vuln.id}`,
            source: 'OSV',
            severity,
            affectedPackage: pkg,
            affectedPattern: pkg,
            description: vuln.summary || vuln.details?.slice(0, 500) || 'OSV vulnerability',
            remediation: vuln.aliases?.join(', ') || 'Update package',
            publishedAt: vuln.published || vuln.modified || new Date().toISOString(),
          });
        }
      }

      return entries;
    } catch (err: any) {
      Logger.debug(`[ThreatIntel] OSV poll error: ${err?.message}`);
      return [];
    }
  }

  /** Poll GitHub Advisory Database for MCP-related advisories */
  private async pollGitHubFeed(): Promise<ThreatIntelEntry[]> {
    try {
      const response = await fetch(
        'https://api.github.com/advisories?type=reviewed&per_page=10&ecosystem=npm',
        {
          headers: {
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!response.ok) return [];
      const advisories = await response.json() as any[];
      const entries: ThreatIntelEntry[] = [];

      const mcpKeywords = ['mcp', 'model context protocol', 'tool calling', 'prompt injection', 'llm'];
      for (const advisory of advisories) {
        const desc = (advisory.description || '').toLowerCase();
        const isRelevant = mcpKeywords.some(k => desc.includes(k));
        if (!isRelevant) continue;

        entries.push({
          id: `gh-${advisory.ghsa_id || advisory.id}`,
          source: 'GitHub',
          severity: (advisory.severity || 'MEDIUM').toUpperCase(),
          affectedPackage: advisory.package?.name,
          description: advisory.summary || advisory.description?.slice(0, 500) || 'GitHub advisory',
          remediation: 'Review GitHub advisory for remediation steps',
          publishedAt: advisory.published_at || advisory.updated_at || new Date().toISOString(),
        });
      }

      return entries;
    } catch (err: any) {
      Logger.debug(`[ThreatIntel] GitHub feed poll error: ${err?.message}`);
      return [];
    }
  }

  /** Load last-seen threat IDs from disk */
  private loadState(): void {
    try {
      if (existsSync(this.statePath)) {
        const data = JSON.parse(readFileSync(this.statePath, 'utf-8'));
        if (Array.isArray(data.ids)) {
          this.lastSeenIds = new Set(data.ids);
          Logger.info(`[ThreatIntel] Loaded ${this.lastSeenIds.size} known threat entries`);
        }
      }
    } catch {
      // Fresh state on first run
    }
  }

  /** Persist last-seen threat IDs */
  private saveState(): void {
    try {
      const dir = dirname(this.statePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.statePath, JSON.stringify({ ids: [...this.lastSeenIds], updated: new Date().toISOString() }));
    } catch (err: any) {
      Logger.warn(`[ThreatIntel] Failed to save state: ${err?.message}`);
    }
  }

  /** Fetch threat entries from a JSON feed file or in-memory array */
  fetchFeed(sourcePath: string): ThreatIntelEntry[] {
    try {
      const raw = readFileSync(sourcePath, 'utf-8');
      const data = JSON.parse(raw);
      const entries: ThreatIntelEntry[] = Array.isArray(data) ? data : (data.entries || data.threats || []);
      return entries.filter((e: any) => e?.id && e?.severity);
    } catch (err: any) {
      Logger.error(`[ThreatIntel] Failed to fetch feed from ${sourcePath}: ${err?.message}`);
      return [];
    }
  }

  /** Diff new entries against last-seen state — returns only previously unseen */
  diffFeed(entries: ThreatIntelEntry[]): ThreatIntelEntry[] {
    const new_ = entries.filter(e => !this.lastSeenIds.has(e.id));
    // Mark all as seen
    for (const e of entries) this.lastSeenIds.add(e.id);
    this.saveState();
    Logger.info(`[ThreatIntel] ${new_.length} new threat entries (${entries.length} total)`);
    return new_;
  }

  /** Convert threat intel entries into policy rules */
  generateRules(entries: ThreatIntelEntry[], existingServerNames?: string[]): ThreatSuggestion[] {
    const suggestions: ThreatSuggestion[] = [];

    for (const entry of entries) {
      const confidence = this.severityToConfidence(entry.severity);
      const action = this.severityToAction(entry.severity);

      // Pattern-based rule from threat signature
      if (entry.signature) {
        suggestions.push({
          rule: {
            name: `threat-${entry.id}`,
            description: `[${entry.severity}] ${entry.description}. Source: ${entry.source}. Remediation: ${entry.remediation}`,
            action,
            patterns: [entry.signature],
          },
          confidence,
          reason: `${entry.severity} threat from ${entry.source}: ${entry.description}`,
          source: 'threat',
          entry,
        });
      }

      // Package-specific block rule
      if (entry.affectedPackage && entry.affectedPattern) {
        suggestions.push({
          rule: {
            name: `threat-pkg-${entry.id}`,
            description: `[${entry.severity}] ${entry.affectedPackage} vulnerability: ${entry.description}`,
            action,
            patterns: [entry.affectedPattern],
          },
          confidence,
          reason: `Affected package ${entry.affectedPackage}: ${entry.description}`,
          source: 'threat',
          entry,
        });
      }
    }

    return suggestions;
  }

  private severityToConfidence(severity: string): number {
    switch (severity) {
      case 'CRITICAL': return 1.0;
      case 'HIGH': return 0.7;
      case 'MEDIUM': return 0.4;
      case 'LOW': return 0.15;
      default: return 0.3;
    }
  }

  private severityToAction(severity: string): PolicyAction {
    switch (severity) {
      case 'CRITICAL': return 'block';
      case 'HIGH': return 'flag';
      default: return 'flag';
    }
  }

  /** Fetch + diff + generate in one call */
  processFeed(sourcePath: string, existingServerNames?: string[]): ThreatSuggestion[] {
    const entries = this.fetchFeed(sourcePath);
    const newEntries = this.diffFeed(entries);
    return this.generateRules(newEntries, existingServerNames);
  }
}