import { getPersistenceStore } from '../utils/persistence-store.js';

interface TrafficPattern {
  tool: string;
  path?: string;
  domain?: string;
  count: number;
  lastSeen: string;
}

interface SuggestedRule {
  type: 'whitelist-path' | 'whitelist-domain' | 'whitelist-tool';
  value: string;
  frequency: number;
  recommendation: string;
}

export class LearningMode {
  private patterns = new Map<string, TrafficPattern>();

  recordAllowedCall(toolName: string, args: Record<string, unknown>): void {
    const path = (args.path || args.file || args.directory) as string | undefined;
    const url = args.url as string | undefined;

    if (path) {
      const key = `path:${toolName}:${path}`;
      const existing = this.patterns.get(key);
      if (existing) { existing.count++; existing.lastSeen = new Date().toISOString(); }
      else this.patterns.set(key, { tool: toolName, path, count: 1, lastSeen: new Date().toISOString() });
    }

    if (url) {
      try { const domain = new URL(url).hostname; const key = `domain:${toolName}:${domain}`; const existing = this.patterns.get(key); if (existing) { existing.count++; existing.lastSeen = new Date().toISOString(); } else this.patterns.set(key, { tool: toolName, domain, count: 1, lastSeen: new Date().toISOString() }); } catch {}
    }

    const toolKey = `tool:${toolName}`;
    const toolPat = this.patterns.get(toolKey);
    if (toolPat) { toolPat.count++; toolPat.lastSeen = new Date().toISOString(); }
    else this.patterns.set(toolKey, { tool: toolName, count: 1, lastSeen: new Date().toISOString() });
  }

  getSuggestions(): SuggestedRule[] {
    const suggestions: SuggestedRule[] = [];
    const store = getPersistenceStore();
    const falsePositives = new Map<string, number>();

    try {
      const rows = store.getCorpusRuleStats ? store.getCorpusRuleStats() : [];
      for (const row of rows || []) {
        falsePositives.set(row.rule_name, row.false_positives || 0);
      }
    } catch {}

    for (const [key, pattern] of this.patterns) {
      if (pattern.count < 5) continue;
      if (key.startsWith('path:')) {
        const isFrequent = pattern.count >= 10;
        suggestions.push({
          type: 'whitelist-path',
          value: `${pattern.tool}:${pattern.path}`,
          frequency: pattern.count,
          recommendation: isFrequent
            ? `Frequently accessed path — consider adding to allowed paths`
            : `Moderately used — monitor for a few more calls before whitelisting`,
        });
      } else if (key.startsWith('domain:')) {
        suggestions.push({
          type: 'whitelist-domain',
          value: `${pattern.tool}:${pattern.domain}`,
          frequency: pattern.count,
          recommendation: pattern.count >= 10
            ? `Add ${pattern.domain} to safe domain whitelist`
            : `Monitor ${pattern.domain} usage before whitelisting`,
        });
      }
    }

    return suggestions.sort((a, b) => b.frequency - a.frequency);
  }

  reset(): void { this.patterns.clear(); }
}

export const learningMode = new LearningMode();
