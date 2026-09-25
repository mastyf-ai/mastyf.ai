/**
 * Policy Diff — compares generated policy against existing policy,
 * producing a human-readable diff with confidence-scored recommendations.
 */
export class PolicyDiff {
    /**
     * Compare a synthesized/generated policy against an existing policy YAML string.
     */
    diff(generated, existingYaml) {
        const additions = [];
        const removals = [];
        const modifications = [];
        if (!existingYaml || existingYaml.trim().length === 0) {
            // No existing policy — everything is an addition
            additions.push({
                ruleType: 'new_policy',
                description: 'No existing policy found — this is an entirely new policy',
                generatedValue: generated.yaml,
                confidence: generated.confidence,
                recommendation: 'Review the full generated policy before applying',
            });
            return {
                additions,
                removals,
                modifications,
                similarityScore: 0,
                summary: `No existing policy found. Generated ${generated.metadata.toolsInPolicy} tool rules and ${generated.metadata.securityRulesGenerated} security rules.`,
            };
        }
        // Extract tool rules from existing YAML
        const existingTools = this.extractToolNames(existingYaml);
        const generatedTools = new Set(generated.metadata.totalToolsObserved > 0
            ? Object.keys(generated.rationale)
            : []);
        // Find additions (in generated but not in existing)
        for (const tool of generatedTools) {
            if (!existingTools.has(tool)) {
                additions.push({
                    ruleType: 'allow_tool',
                    description: `New tool rule: ${tool}`,
                    generatedValue: tool,
                    confidence: 0.7,
                    recommendation: `Add allow rule for ${tool} based on observed usage`,
                });
            }
        }
        // Find removals (in existing but not in generated)
        for (const tool of existingTools) {
            if (!generatedTools.has(tool)) {
                removals.push({
                    ruleType: 'allow_tool',
                    description: `Unused tool: ${tool}`,
                    generatedValue: '(not observed)',
                    existingValue: tool,
                    confidence: 0.5,
                    recommendation: `Tool ${tool} was not observed — consider removing or keeping as optional`,
                });
            }
        }
        // Find modifications (same tool, different config)
        // For simplicity, we flag tools present in both as potential modification candidates
        for (const tool of generatedTools) {
            if (existingTools.has(tool) && generated.rationale[tool]) {
                modifications.push({
                    ruleType: 'allow_tool',
                    description: `Review rule for: ${tool}`,
                    generatedValue: generated.rationale[tool] || '',
                    existingValue: '(existing rule present)',
                    confidence: 0.6,
                    recommendation: `Compare generated vs existing rule for ${tool}`,
                });
            }
        }
        // Compute similarity
        const totalUnique = new Set([...existingTools, ...generatedTools]).size;
        const overlap = [...generatedTools].filter(t => existingTools.has(t)).length;
        const similarityScore = totalUnique > 0 ? overlap / totalUnique : 0;
        return {
            additions,
            removals,
            modifications,
            similarityScore: Math.round(similarityScore * 100) / 100,
            summary: `${additions.length} additions, ${removals.length} removals, ${modifications.length} modifications. ${Math.round(similarityScore * 100)}% overlap with existing policy.`,
        };
    }
    /** Extract tool names referenced in a YAML policy string. */
    extractToolNames(yaml) {
        const tools = new Set();
        const lines = yaml.split('\n');
        for (const line of lines) {
            // Match `tool: "name"` or `tool: name`
            const toolMatch = line.match(/^\s*tool:\s*"?([a-zA-Z0-9_-]+)"?\s*$/);
            if (toolMatch) {
                tools.add(toolMatch[1]);
            }
        }
        return tools;
    }
    /**
     * Generate a human-readable markdown diff report.
     */
    toMarkdown(diff) {
        const lines = [];
        lines.push('# Policy Diff Report');
        lines.push('');
        lines.push(`**Similarity:** ${Math.round(diff.similarityScore * 100)}%`);
        lines.push(`**Summary:** ${diff.summary}`);
        lines.push('');
        if (diff.additions.length > 0) {
            lines.push('## ➕ Additions');
            lines.push('');
            for (const add of diff.additions) {
                lines.push(`- **[${add.ruleType}]** ${add.description} (confidence: ${(add.confidence * 100).toFixed(0)}%)`);
                lines.push(`  → ${add.recommendation}`);
            }
            lines.push('');
        }
        if (diff.removals.length > 0) {
            lines.push('## ➖ Removals');
            lines.push('');
            for (const rem of diff.removals) {
                lines.push(`- **[${rem.ruleType}]** ${rem.description} (confidence: ${(rem.confidence * 100).toFixed(0)}%)`);
                lines.push(`  → ${rem.recommendation}`);
            }
            lines.push('');
        }
        if (diff.modifications.length > 0) {
            lines.push('## ✏️ Modifications');
            lines.push('');
            for (const mod of diff.modifications) {
                lines.push(`- **[${mod.ruleType}]** ${mod.description} (confidence: ${(mod.confidence * 100).toFixed(0)}%)`);
                lines.push(`  → ${mod.recommendation}`);
            }
            lines.push('');
        }
        return lines.join('\n');
    }
}
//# sourceMappingURL=policy-diff.js.map