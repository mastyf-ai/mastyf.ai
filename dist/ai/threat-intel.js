import { Logger } from '../utils/logger.js';
import { isDemoThreatId } from '../utils/dashboard-live-data.js';
import { resolveThreatStatePath } from './ai-paths.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { dirname } from 'path';
let sharedThreatIntel = null;
/** Shared ThreatIntel instance (proxy, dashboard, learning engine). */
export function getSharedThreatIntel(statePath) {
    if (!sharedThreatIntel) {
        sharedThreatIntel = new ThreatIntel(statePath);
    }
    return sharedThreatIntel;
}
/** Start live NVD/OSV/GitHub polling unless explicitly disabled. */
export function startThreatIntelPollingIfEnabled() {
    const ti = getSharedThreatIntel();
    if (process.env.MASTYF_AI_AI_DISABLE_THREAT_POLL === 'true') {
        return ti;
    }
    const intervalMs = parseInt(process.env.MASTYF_AI_AI_THREAT_POLL_MS || String(30 * 60 * 1000), 10);
    ti.startLivePolling(intervalMs);
    return ti;
}
/**
 * Threat intelligence integration — ingests MCP-specific threat feeds and
 * auto-generates blocking policy rules based on severity and applicability.
 * Maintains a last-seen state to only process new entries on each fetch.
 */
export class ThreatIntel {
    lastSeenIds = new Set();
    knownEntries = new Map();
    statePath;
    pollTimer = null;
    lastUpdated = null;
    lastPollAt = null;
    nvdApiKey;
    suppressed = new Map();
    quarantineArchive = [];
    constructor(statePath) {
        this.statePath = statePath || resolveThreatStatePath();
        this.nvdApiKey = process.env['NVD_API_KEY'] || '';
        this.loadState();
    }
    /** Start periodic polling of live threat feeds (NVD, OSV, GitHub) */
    startLivePolling(intervalMs = 30 * 60 * 1000) {
        if (this.pollTimer)
            return;
        Logger.info(`[ThreatIntel] Starting live feed polling every ${intervalMs / 1000}s`);
        this.pollTimer = setInterval(() => {
            this.pollLiveFeeds().catch(err => {
                Logger.warn(`[ThreatIntel] Live feed poll failed: ${err?.message}`);
            });
        }, intervalMs);
        // Initial poll
        this.pollLiveFeeds().catch(() => { });
    }
    /** Stop live polling */
    stopLivePolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }
    /** Poll all live threat feed sources */
    async pollLiveFeeds() {
        this.lastPollAt = new Date().toISOString();
        const results = await Promise.allSettled([
            this.pollNvdFeed(),
            this.pollOsvFeed(),
            this.pollGitHubFeed(),
        ]);
        const allEntries = [];
        for (const result of results) {
            if (result.status === 'fulfilled') {
                allEntries.push(...result.value);
            }
        }
        if (allEntries.length > 0) {
            const newEntries = this.diffFeed(allEntries);
            Logger.info(`[ThreatIntel] Live poll: ${allEntries.length} total, ${newEntries.length} new threats`);
            const activeEntries = newEntries.filter((e) => !this.suppressed.has(e.id));
            if (activeEntries.length > 0 && process.env.MASTYF_AI_THREAT_RESEARCH_THREAT_INTEL !== 'false') {
                setImmediate(() => {
                    void import('./threat-research-pipeline.js').then(({ buildThreatIntelEvent, enqueueThreatResearch }) => {
                        for (const entry of activeEntries) {
                            enqueueThreatResearch(buildThreatIntelEvent(entry));
                        }
                    });
                });
            }
            return activeEntries;
        }
        this.saveState();
        return [];
    }
    isPollingActive() {
        return this.pollTimer !== null;
    }
    /** Dashboard / API snapshot of known threat feed IDs and metadata. */
    getStatus() {
        const entries = [...this.knownEntries.values()]
            .filter((e) => !this.suppressed.has(e.id))
            .filter((e) => !isDemoThreatId(e.id))
            .sort((a, b) => (b.firstSeenAt || '').localeCompare(a.firstSeenAt || ''));
        const knownIds = entries.map((e) => e.id);
        return {
            threats: knownIds.length,
            knownIds,
            entries,
            updated: this.lastUpdated,
            lastPollAt: this.lastPollAt,
            pollingActive: this.isPollingActive(),
            pollingDisabled: process.env.MASTYF_AI_AI_DISABLE_THREAT_POLL === 'true',
            suppressed: this.suppressed.size,
        };
    }
    /** Recent catalog entries for Threat Lab / learning cycle (severity filter optional). */
    getCatalogEntries(opts) {
        const order = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
        const minIdx = opts?.minSeverity ? order.indexOf(opts.minSeverity) : 0;
        const limit = opts?.limit ?? 50;
        return [...this.knownEntries.values()]
            .filter((e) => !this.suppressed.has(e.id))
            .filter((e) => !isDemoThreatId(e.id))
            .filter((e) => order.indexOf(e.severity) >= minIdx)
            .sort((a, b) => (b.firstSeenAt || '').localeCompare(a.firstSeenAt || ''))
            .slice(0, limit)
            .map(({ firstSeenAt: _fs, ...entry }) => entry);
    }
    dismissThreat(id, operator, note) {
        const entry = this.knownEntries.get(id);
        if (!entry)
            return { ok: false, error: `Unknown threat id: ${id}` };
        const existing = this.suppressed.get(id);
        if (existing)
            return { ok: false, error: `Threat already ${existing.action}` };
        this.suppressed.set(id, { action: 'removed', at: new Date().toISOString(), by: operator });
        this.saveState();
        return { ok: true, entry };
    }
    quarantineThreat(id, opts) {
        const entry = this.knownEntries.get(id);
        if (!entry)
            return { ok: false, error: `Unknown threat id: ${id}` };
        const existing = this.suppressed.get(id);
        if (existing)
            return { ok: false, error: `Threat already ${existing.action}` };
        const now = new Date().toISOString();
        const record = {
            id: entry.id,
            source: entry.source,
            severity: entry.severity,
            description: entry.description,
            remediation: entry.remediation,
            publishedAt: entry.publishedAt,
            affectedPackage: entry.affectedPackage,
            affectedPattern: entry.affectedPattern,
            signature: entry.signature,
            quarantinedAt: now,
            operator: opts?.operator,
            note: opts?.note,
            appliedRuleName: opts?.appliedRuleName,
            policyPath: opts?.policyPath,
        };
        this.suppressed.set(id, { action: 'quarantined', at: now, by: opts?.operator });
        this.quarantineArchive.push(record);
        this.purgeQuarantineArchive(30);
        this.saveState();
        return { ok: true, record };
    }
    restoreThreat(id) {
        if (!this.suppressed.has(id))
            return { ok: false, error: `Threat is not suppressed: ${id}` };
        this.suppressed.delete(id);
        this.saveState();
        return { ok: true };
    }
    listQuarantined(days = 30) {
        this.purgeQuarantineArchive(days);
        return [...this.quarantineArchive].sort((a, b) => Date.parse(b.quarantinedAt || '') - Date.parse(a.quarantinedAt || ''));
    }
    getEntryById(id) {
        return this.knownEntries.get(id) ?? null;
    }
    /** Poll NVD API v2 for recent CVEs relevant to MCP ecosystem */
    async pollNvdFeed() {
        try {
            const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            // Search for MCP-relevant keywords
            const keywords = ['model context protocol', 'mcp server', 'prompt injection', 'LLM', 'tool calling'];
            const entries = [];
            for (const keyword of keywords) {
                const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(keyword)}&pubStartDate=${lastWeek}&resultsPerPage=10`;
                const headers = {};
                if (this.nvdApiKey)
                    headers['apiKey'] = this.nvdApiKey;
                const response = await fetch(url, {
                    headers,
                    signal: AbortSignal.timeout(10000),
                });
                if (!response.ok)
                    continue;
                const data = await response.json();
                const vulns = data?.vulnerabilities || [];
                for (const vuln of vulns) {
                    const cve = vuln.cve;
                    if (!cve?.id)
                        continue;
                    const severity = cve.metrics?.cvssMetricV31?.[0]?.cvssData?.baseSeverity ||
                        cve.metrics?.cvssMetricV30?.[0]?.cvssData?.baseSeverity || 'MEDIUM';
                    const desc = cve.descriptions?.find((d) => d.lang === 'en')?.value || 'No description';
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
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            Logger.debug(`[ThreatIntel] NVD poll error: ${message}`);
            return [];
        }
    }
    /** Poll OSV.dev API for MCP ecosystem vulnerabilities */
    async pollOsvFeed() {
        try {
            // Query OSV.dev for common MCP-related packages
            const packages = ['@modelcontextprotocol/sdk', 'mcp-server', 'mastyf-ai'];
            const entries = [];
            for (const pkg of packages) {
                const response = await fetch('https://api.osv.dev/v1/query', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ package: { name: pkg, ecosystem: 'npm' } }),
                    signal: AbortSignal.timeout(10000),
                });
                if (!response.ok)
                    continue;
                const data = await response.json();
                const vulns = data?.vulns || [];
                for (const vuln of vulns) {
                    // OSV severity[].score is a CVSS vector string, not a number.
                    // Extract numeric score from database_specific or compute from the vector.
                    const cvssSev = vuln.severity?.find((s) => s.type === 'CVSS_V3');
                    let numericScore = null;
                    if (cvssSev) {
                        // Try numeric score from database_specific first
                        const dbScore = parseFloat(cvssSev.database_specific?.cvss?.score);
                        if (!isNaN(dbScore)) {
                            numericScore = dbScore;
                        }
                        else {
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
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            Logger.debug(`[ThreatIntel] OSV poll error: ${message}`);
            return [];
        }
    }
    /** Poll GitHub Advisory Database for MCP-related advisories */
    async pollGitHubFeed() {
        try {
            const response = await fetch('https://api.github.com/advisories?type=reviewed&per_page=30&ecosystem=npm', {
                headers: {
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                },
                signal: AbortSignal.timeout(10000),
            });
            if (!response.ok)
                return [];
            const advisories = await response.json();
            const entries = [];
            const mcpKeywords = ['mcp', 'model context protocol', 'tool calling', 'prompt injection', 'llm'];
            for (const advisory of advisories) {
                const desc = (advisory.description || '').toLowerCase();
                const isRelevant = mcpKeywords.some(k => desc.includes(k));
                if (!isRelevant)
                    continue;
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
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            Logger.debug(`[ThreatIntel] GitHub feed poll error: ${message}`);
            return [];
        }
    }
    /** Load last-seen threat IDs from disk */
    loadState() {
        try {
            if (existsSync(this.statePath)) {
                const data = JSON.parse(readFileSync(this.statePath, 'utf-8'));
                if (Array.isArray(data.ids)) {
                    this.lastSeenIds = new Set(data.ids.filter((id) => typeof id === 'string' && !isDemoThreatId(id)));
                }
                if (typeof data.updated === 'string') {
                    this.lastUpdated = data.updated;
                }
                if (typeof data.lastPollAt === 'string') {
                    this.lastPollAt = data.lastPollAt;
                }
                const catalog = data.entries;
                if (Array.isArray(catalog)) {
                    for (const entry of catalog) {
                        if (entry?.id && !isDemoThreatId(entry.id)) {
                            this.knownEntries.set(entry.id, entry);
                        }
                    }
                }
                else if (catalog && typeof catalog === 'object') {
                    for (const [id, entry] of Object.entries(catalog)) {
                        if (entry && typeof entry === 'object' && !isDemoThreatId(id)) {
                            this.knownEntries.set(id, entry);
                        }
                    }
                }
                const suppressed = data.suppressed;
                if (suppressed && typeof suppressed === 'object') {
                    for (const [id, val] of Object.entries(suppressed)) {
                        if (!id || isDemoThreatId(id) || !val || typeof val !== 'object')
                            continue;
                        const action = String(val.action || '');
                        if (action !== 'removed' && action !== 'quarantined')
                            continue;
                        this.suppressed.set(id, {
                            action,
                            at: String(val.at || new Date().toISOString()),
                            by: typeof val.by === 'string'
                                ? String(val.by)
                                : undefined,
                        });
                    }
                }
                const archive = data.quarantineArchive;
                if (Array.isArray(archive)) {
                    for (const row of archive) {
                        if (!row || typeof row !== 'object')
                            continue;
                        const r = row;
                        if (!r.id || isDemoThreatId(String(r.id)))
                            continue;
                        if (!r.quarantinedAt)
                            continue;
                        this.quarantineArchive.push({
                            id: String(r.id),
                            source: String(r.source || 'custom'),
                            severity: String(r.severity || 'MEDIUM'),
                            description: String(r.description || ''),
                            remediation: String(r.remediation || ''),
                            publishedAt: String(r.publishedAt || ''),
                            affectedPackage: r.affectedPackage ? String(r.affectedPackage) : undefined,
                            affectedPattern: r.affectedPattern ? String(r.affectedPattern) : undefined,
                            signature: r.signature ? String(r.signature) : undefined,
                            quarantinedAt: String(r.quarantinedAt),
                            operator: r.operator ? String(r.operator) : undefined,
                            note: r.note ? String(r.note) : undefined,
                            appliedRuleName: r.appliedRuleName ? String(r.appliedRuleName) : undefined,
                            policyPath: r.policyPath ? String(r.policyPath) : undefined,
                        });
                    }
                }
                this.purgeQuarantineArchive(30);
                Logger.info(`[ThreatIntel] Loaded ${this.knownEntries.size} threat catalog entries`);
            }
        }
        catch {
            // Fresh state on first run
        }
    }
    /** Persist last-seen threat IDs */
    saveState() {
        try {
            const dir = dirname(this.statePath);
            if (!existsSync(dir))
                mkdirSync(dir, { recursive: true });
            this.lastUpdated = new Date().toISOString();
            const tmpPath = `${this.statePath}.tmp`;
            writeFileSync(tmpPath, JSON.stringify({
                ids: [...this.knownEntries.keys()],
                updated: this.lastUpdated,
                lastPollAt: this.lastPollAt,
                entries: [...this.knownEntries.values()],
                suppressed: Object.fromEntries(this.suppressed.entries()),
                quarantineArchive: this.quarantineArchive,
            }, null, 2));
            renameSync(tmpPath, this.statePath);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            Logger.warn(`[ThreatIntel] Failed to save state: ${message}`);
        }
    }
    rememberEntry(entry) {
        if (isDemoThreatId(entry.id))
            return;
        const existing = this.knownEntries.get(entry.id);
        this.knownEntries.set(entry.id, {
            ...entry,
            firstSeenAt: existing?.firstSeenAt || new Date().toISOString(),
        });
    }
    /** Fetch threat entries from a JSON feed file or in-memory array */
    fetchFeed(sourcePath) {
        try {
            const raw = readFileSync(sourcePath, 'utf-8');
            const data = JSON.parse(raw);
            const entries = Array.isArray(data) ? data : (data.entries || data.threats || []);
            return entries.filter((e) => e?.id && e?.severity);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            Logger.error(`[ThreatIntel] Failed to fetch feed from ${sourcePath}: ${message}`);
            return [];
        }
    }
    /** Diff new entries against last-seen state — returns only previously unseen */
    diffFeed(entries) {
        const live = entries.filter((e) => !isDemoThreatId(e.id));
        const new_ = live.filter((e) => !this.lastSeenIds.has(e.id) && !this.suppressed.has(e.id));
        for (const e of live) {
            this.lastSeenIds.add(e.id);
            this.rememberEntry(e);
        }
        this.saveState();
        Logger.info(`[ThreatIntel] ${new_.length} new threat entries (${live.length} total)`);
        return new_;
    }
    purgeQuarantineArchive(days) {
        const maxDays = Number.isFinite(days) && days > 0 ? days : 30;
        const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
        this.quarantineArchive = this.quarantineArchive.filter((r) => {
            const ts = Date.parse(r.quarantinedAt || '');
            return Number.isFinite(ts) && ts >= cutoff;
        });
    }
    /** Convert threat intel entries into policy rules */
    generateRules(entries, existingServerNames) {
        const suggestions = [];
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
    severityToConfidence(severity) {
        switch (severity) {
            case 'CRITICAL': return 1.0;
            case 'HIGH': return 0.7;
            case 'MEDIUM': return 0.4;
            case 'LOW': return 0.15;
            default: return 0.3;
        }
    }
    severityToAction(severity) {
        switch (severity) {
            case 'CRITICAL': return 'block';
            case 'HIGH': return 'flag';
            default: return 'flag';
        }
    }
    /** Fetch + diff + generate in one call */
    processFeed(sourcePath, existingServerNames) {
        const entries = this.fetchFeed(sourcePath);
        const newEntries = this.diffFeed(entries);
        return this.generateRules(newEntries, existingServerNames);
    }
}
//# sourceMappingURL=threat-intel.js.map