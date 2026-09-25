import { Logger } from '../utils/logger.js';
import { LlmAssistant } from './llm-assistant.js';
/**
 * Policy-as-Code AI Assist — converts natural-language policy goals into
 * valid YAML-ready PolicyRule objects with regex patterns and RBAC configuration.
 */
export class PolicyAssist {
    llm;
    constructor(llm) {
        this.llm = llm || new LlmAssistant();
    }
    /**
     * Generate a rule with LLM enhancement. Falls back to regex parsing if unavailable.
     */
    async generateRuleWithLLM(goal, availableTools) {
        // Try LLM first for richer pattern generation
        const llmResult = await this.llm.generatePolicyRule(goal, availableTools);
        if (llmResult) {
            Logger.info(`[PolicyAssist] LLM generated rule for: "${goal}"`);
            return {
                rule: {
                    name: `assist-llm-${Date.now()}`,
                    description: llmResult.explanation,
                    action: 'block',
                    patterns: ['.*'],
                },
                confidence: 0.85,
                reason: llmResult.explanation,
                source: 'assist',
                goal,
            };
        }
        // Fallback to regex-based parsing
        Logger.debug(`[PolicyAssist] LLM unavailable, using regex parsing for: "${goal}"`);
        return this.generateRule(goal, availableTools);
    }
    /**
     * Parse a natural-language goal into structured intent.
     */
    parseGoal(goal) {
        const g = goal.toLowerCase().trim();
        // Rate limit: "rate limit X to 10/min" or "limit calls to 60 per minute"
        const rateMatch = g.match(/rate\s*[- ]?limit|limit\s+(?:calls|requests)/i);
        if (rateMatch) {
            const numMatch = g.match(/(\d+)\s*(?:\/|per)\s*(?:min|minute)/i);
            const targets = this.extractTools(g, rateMatch.index + rateMatch[0].length);
            return { raw: goal, intent: 'rate_limit', targets, numericValue: numMatch ? parseInt(numMatch[1]) : 60 };
        }
        // Token budget: "limit tokens to 50k" or "cap tokens at 10000"
        const tokenMatch = g.match(/token|budget|cap\s+(?:tokens?|usage)/i);
        if (tokenMatch) {
            const numMatch = g.match(/(\d+)\s*[kK]?/i);
            const value = numMatch ? parseInt(numMatch[1]) * (g.includes('k') || g.includes('K') ? 1000 : 1) : 50000;
            const targets = this.extractTools(g, tokenMatch.index + tokenMatch[0].length);
            return { raw: goal, intent: 'token_budget', targets, numericValue: value };
        }
        // Block tools: "block shell tools" or "deny execute_command"
        const blockMatch = g.match(/block|deny|disable|stop/i);
        if (blockMatch) {
            const targets = this.extractTools(g, blockMatch.index + blockMatch[0].length);
            return { raw: goal, intent: 'tool_block', targets };
        }
        // Allow tools: "allow only read_file" or "restrict to X"
        const allowMatch = g.match(/allow\s+(?:only\s+)?|restrict\s+(?:to\s+)?/i);
        if (allowMatch) {
            const targets = this.extractTools(g, allowMatch.index + allowMatch[0].length);
            return { raw: goal, intent: 'tool_allow', targets };
        }
        // Scope restrict: "require admin scope for X"
        const scopeMatch = g.match(/require|need|scope|admin|read-only|write/i);
        if (scopeMatch) {
            const scopeExtract = g.match(/(?:scope|permission|role)\s*(?:of|is|for)?\s*["']?(\w[\w-]*)["']?/i);
            const targets = this.extractTools(g, scopeMatch.index + scopeMatch[0].length);
            return { raw: goal, intent: 'scope_restrict', targets, scope: scopeExtract?.[1] || 'admin' };
        }
        // Pattern block: "block external URLs" or "prevent shell injection"
        const patternMatch = g.match(/pattern|regex|url|injection|command|path|traversal|shell/i);
        if (patternMatch) {
            const targets = this.extractTools(g, 0);
            return { raw: goal, intent: 'pattern_block', targets };
        }
        return { raw: goal, intent: 'unknown', targets: [] };
    }
    /**
     * Generate a complete PolicyRule from a natural-language goal.
     */
    generateRule(goal, availableTools) {
        const parsed = this.parseGoal(goal);
        switch (parsed.intent) {
            case 'tool_block':
                return this.buildBlockRule(parsed, availableTools);
            case 'tool_allow':
                return this.buildAllowRule(parsed, availableTools);
            case 'rate_limit':
                return this.buildRateLimitRule(parsed);
            case 'token_budget':
                return this.buildTokenBudgetRule(parsed);
            case 'pattern_block':
                return this.buildPatternBlockRule(parsed);
            case 'scope_restrict':
                return this.buildScopeRestrictRule(parsed);
            default:
                return null;
        }
    }
    /**
     * Generate YAML-ready string for a rule.
     */
    toYAML(rule) {
        const lines = [];
        lines.push(`- name: ${rule.name}`);
        if (rule.description)
            lines.push(`  description: "${rule.description}"`);
        lines.push(`  action: ${rule.action}`);
        if (rule.tools?.allow?.length) {
            lines.push(`  tools:`);
            lines.push(`    allow: [${rule.tools.allow.join(', ')}]`);
        }
        if (rule.tools?.deny?.length) {
            lines.push(`  tools:`);
            lines.push(`    deny: [${rule.tools.deny.join(', ')}]`);
        }
        if (rule.patterns?.length) {
            lines.push(`  patterns:`);
            for (const p of rule.patterns)
                lines.push(`    - '${p}'`);
        }
        if (rule.maxCallsPerMinute)
            lines.push(`  maxCallsPerMinute: ${rule.maxCallsPerMinute}`);
        if (rule.maxTokens)
            lines.push(`  maxTokens: ${rule.maxTokens}`);
        if (rule.rbac) {
            lines.push(`  rbac:`);
            if (rule.rbac.scopes?.length)
                lines.push(`    scopes: [${rule.rbac.scopes.join(', ')}]`);
            if (rule.rbac.clientIds?.length)
                lines.push(`    clientIds: [${rule.rbac.clientIds.join(', ')}]`);
        }
        return lines.join('\n');
    }
    // ── Private builders ──────────────────────────────────────────────────
    buildBlockRule(goal, availableTools) {
        const resolved = this.resolveTools(goal.targets, availableTools);
        const targets = resolved.length > 0 ? resolved : (goal.targets.length > 0 ? goal.targets : ['target-tool']);
        return {
            rule: {
                name: `assist-block-${targets[0]}`,
                description: `User goal: "${goal.raw}"`,
                action: 'block',
                tools: { deny: targets },
            },
            confidence: 1.0,
            reason: `Blocking tools: ${targets.join(', ')}`,
            source: 'assist',
            goal: goal.raw,
        };
    }
    buildAllowRule(goal, availableTools) {
        const resolved = this.resolveTools(goal.targets, availableTools);
        const targets = resolved.length > 0 ? resolved : (goal.targets.length > 0 ? goal.targets : ['target-tool']);
        return {
            rule: {
                name: `assist-allow-${targets[0]}`,
                description: `User goal: "${goal.raw}"`,
                action: 'block',
                tools: { allow: targets },
            },
            confidence: 1.0,
            reason: `Allowing only: ${targets.join(', ')}`,
            source: 'assist',
            goal: goal.raw,
        };
    }
    buildRateLimitRule(goal) {
        const cap = goal.numericValue || 60;
        return {
            rule: {
                name: `assist-rate-limit`,
                description: `User goal: "${goal.raw}"`,
                action: 'flag',
                maxCallsPerMinute: cap,
                ...(goal.targets.length > 0 ? { tools: { deny: goal.targets } } : {}),
            },
            confidence: 1.0,
            reason: `Rate limiting to ${cap} calls/min`,
            source: 'assist',
            goal: goal.raw,
        };
    }
    buildTokenBudgetRule(goal) {
        const cap = goal.numericValue || 50000;
        return {
            rule: {
                name: `assist-token-budget`,
                description: `User goal: "${goal.raw}"`,
                action: 'flag',
                maxTokens: cap,
            },
            confidence: 1.0,
            reason: `Token budget set to ${cap}`,
            source: 'assist',
            goal: goal.raw,
        };
    }
    buildPatternBlockRule(goal) {
        const patterns = this.expandPatterns(goal.raw);
        return {
            rule: {
                name: `assist-pattern-block`,
                description: `User goal: "${goal.raw}"`,
                action: 'block',
                patterns,
            },
            confidence: 0.9,
            reason: `Blocking patterns: ${patterns.join(', ')}`,
            source: 'assist',
            goal: goal.raw,
        };
    }
    buildScopeRestrictRule(goal) {
        const scope = goal.scope || 'admin';
        const targets = goal.targets.length > 0 ? goal.targets : ['target-tool'];
        return {
            rule: {
                name: `assist-scope-${scope}`,
                description: `User goal: "${goal.raw}"`,
                action: 'block',
                tools: { deny: targets },
                rbac: { scopes: [scope] },
            },
            confidence: 1.0,
            reason: `Requiring scope '${scope}' for: ${targets.join(', ')}`,
            source: 'assist',
            goal: goal.raw,
        };
    }
    /**
     * Expand high-level concepts into specific regex patterns.
     */
    expandPatterns(goal) {
        const patterns = [];
        if (/url|http|external|web/i.test(goal)) {
            patterns.push('\\bhttps?:\\/\\/[^\\s"\']+');
            patterns.push('\\bcurl\\s|wget\\s|fetch\\s');
        }
        if (/shell|command|injection/i.test(goal)) {
            patterns.push(';\\s*\\w');
            patterns.push('&&|\\|\\|');
            patterns.push('\\$\\([^)]+\\)');
            patterns.push('`[^`]+`');
        }
        if (/path|traversal|directory|file/i.test(goal)) {
            patterns.push('\\.\\.\\/');
            patterns.push('\\/etc\\/(?:passwd|shadow|hosts)');
        }
        if (/secret|key|token|credential/i.test(goal)) {
            patterns.push('\\b(?:api[_-]?key|secret|token|password|credential)\\b');
        }
        return patterns.length > 0 ? patterns : ['.*'];
    }
    /**
     * Extract tool names from the goal string using common patterns.
     */
    extractTools(goal, startIndex) {
        const afterIntent = goal.slice(startIndex);
        const toolMatch = afterIntent.match(/[\w_-]+(?:,\s*[\w_-]+)*/);
        if (toolMatch) {
            return toolMatch[0].split(',').map(t => t.trim()).filter(t => t.length > 1);
        }
        return [];
    }
    /**
     * Resolve fuzzy tool names against known available tools.
     */
    resolveTools(targets, availableTools) {
        if (!availableTools || availableTools.length === 0)
            return targets;
        const resolved = [];
        for (const target of targets) {
            // Map semantic categories to tool names
            const categoryMap = {
                shell: ['execute_command', 'bash', 'sh', 'eval', 'exec', 'system', 'spawn', 'fork', 'popen', 'source'],
                file: ['read_file', 'write_file', 'list_directory', 'read_text_file', 'search_files', 'search_content', 'list_files'],
                database: ['query', 'execute_sql', 'run_sql', 'postgres', 'mysql', 'sqlite', 'db_query'],
                network: ['curl', 'wget', 'fetch', 'http_request', 'api_call'],
                write: ['write_file', 'write_to_file', 'replace_in_file', 'edit_file', 'create_file'],
                delete: ['delete_file', 'remove_file', 'delete_files', 'rm', 'unlink'],
            };
            const category = target.toLowerCase();
            if (categoryMap[category]) {
                resolved.push(...categoryMap[category].filter(t => availableTools.includes(t)));
            }
            else if (availableTools.includes(target)) {
                resolved.push(target);
            }
            else {
                // Fuzzy match: find tools containing the target string
                const matches = availableTools.filter(t => t.toLowerCase().includes(category));
                if (matches.length > 0)
                    resolved.push(...matches);
                else
                    resolved.push(target); // Keep original if no match
            }
        }
        return [...new Set(resolved)];
    }
}
//# sourceMappingURL=policy-assist.js.map