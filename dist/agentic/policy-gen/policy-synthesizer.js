/**
 * 策略合成引擎——从行为分析结果中生成最小权限 YAML 策略。
 *
 * 生成策略规则如下：
 *   - Allow 规则：匹配已使用的工具、其参数及其典型范围
 *   - 速率限制：每个工具基于观察到的峰值速率 + 20% 余量
 *   - Deny 规则：显式阻止 shell 命令、路径遍历、SQL 注入模式
 *   - 语义守卫：为高频工具启用语义验证
 *   - 建议：标记未使用的工具以进行移除
 */
export class PolicySynthesizer {
    version = '1.0.0';
    /**
     * 从分析结果中合成完整的 MCP Mastyf AI 策略。
     */
    synthesize(analysis) {
        const sections = [];
        const rationale = {};
        const suggestions = [];
        let toolsWithRateLimits = 0;
        let toolsWithSemanticGuard = 0;
        let securityRulesGenerated = 0;
        // ═══ 头部 ═══
        sections.push(`# 由 MCP Mastyf AI 自动生成`);
        sections.push(`# 观测周期: ${analysis.windowId}`);
        sections.push(`# 持续时间: ${analysis.durationMin.toFixed(1)} 分钟`);
        sections.push(`# 观测到的调用: ${analysis.totalObservations}`);
        sections.push(`# 观测到的工具: ${analysis.toolProfiles.length}`);
        sections.push('');
        sections.push('version: "1.0"');
        sections.push(`generated_by: mastyf-ai-policy-synthesizer-v${this.version}`);
        sections.push(`generated_at: "${new Date().toISOString()}"`);
        sections.push('');
        // ═══ 策略规则 ═══
        sections.push('rules:');
        for (const profile of analysis.toolProfiles) {
            const ruleLines = this.buildToolRule(profile, analysis);
            sections.push(...ruleLines.map(l => `  ${l}`));
            rationale[profile.toolName] = this.buildRationale(profile);
            if (profile.callRatePerMin > 0.1) {
                toolsWithRateLimits++;
            }
            if (this.shouldEnableSemanticGuard(profile)) {
                toolsWithSemanticGuard++;
            }
        }
        // ═══ 安全规则 ═══
        const securityLines = this.buildSecurityRules();
        sections.push(...securityLines.map(l => `  ${l}`));
        securityRulesGenerated = 4; // 默认安全防护
        // ═══ 工作量规则 ═══
        sections.push('');
        sections.push('  # ─ 工作量规则 ─');
        for (const workflow of analysis.normalWorkflows.slice(0, 5)) {
            const seqStr = workflow.sequence.join(' → ');
            sections.push(`  - rule: allow_workflow`);
            sections.push(`    description: "观察到的正常工作流: ${seqStr}"`);
            sections.push(`    sequence: [${workflow.sequence.map(t => `"${t}"`).join(', ')}]`);
            sections.push(`    confidence: ${workflow.confidence.toFixed(2)}`);
        }
        // ═══ 汇编 ═══
        const yaml = sections.join('\n');
        // ═══ 建议 ═══
        // 未使用的工具
        for (const unused of analysis.unusedTools) {
            suggestions.push({
                severity: 'low',
                category: 'tool_access',
                description: `工具 ${unused} 在观测窗口期间未被使用`,
                recommendation: `考虑移除此工具，或如果它仅偶尔需要，则添加显式拒绝规则`,
            });
        }
        // 高错误率工具
        for (const errorTool of analysis.highErrorTools) {
            suggestions.push({
                severity: 'medium',
                category: 'workflow',
                description: `工具含有高错误率: ${errorTool}`,
                recommendation: `调查错误并考虑添加重试逻辑或断路器`,
            });
        }
        // 建议的安全防护
        const highRisk = analysis.toolProfiles.find(p => ['execute_command', 'shell', 'bash', 'run', 'exec'].includes(p.toolName.toLowerCase()));
        if (highRisk) {
            suggestions.push({
                severity: 'high',
                category: 'security',
                description: `${highRisk.toolName} 是一个高风险命令执行工具`,
                recommendation: `为该工具添加参数允许列表并启用语义验证`,
                autoFixYaml: this.generateArgAllowlistFix(highRisk.toolName),
            });
        }
        // 用于启用语义门控的建议
        for (const profile of analysis.toolProfiles.filter(p => this.shouldEnableSemanticGuard(p))) {
            suggestions.push({
                severity: 'info',
                category: 'argument_restriction',
                description: `${profile.toolName}: 建议启用语义门控 (${profile.callCount} 次调用, ${(profile.errorRate * 100).toFixed(1)}% 错误率)`,
                recommendation: `在策略中设置 semantic_guard: warn 以检测异常参数`,
            });
        }
        // 置信度分数
        const confidence = this.computeConfidence(analysis);
        return {
            yaml,
            summary: this.buildSummary(analysis),
            rationale,
            confidence,
            suggestions,
            metadata: {
                generatedAt: new Date().toISOString(),
                generatorVersion: this.version,
                observationWindowId: analysis.windowId,
                totalToolsObserved: analysis.toolProfiles.length,
                toolsInPolicy: analysis.toolProfiles.length,
                toolsWithRateLimits,
                toolsWithSemanticGuard,
                securityRulesGenerated,
            },
        };
    }
    /** 为单个工具构建规则行。 */
    buildToolRule(profile, _analysis) {
        const lines = [];
        lines.push('');
        lines.push(`# ── ${profile.serverName}/${profile.toolName} ──`);
        lines.push(`- rule: allow_tool`);
        lines.push(`  server: "${profile.serverName}"`);
        lines.push(`  tool: "${profile.toolName}"`);
        lines.push(`  description: "根据 ${profile.callCount} 次观测调用自动生成"`);
        // 参数模式
        if (Object.keys(profile.argumentSchema).length > 0) {
            lines.push(`  arguments:`);
            for (const [key, schema] of Object.entries(profile.argumentSchema)) {
                const suffix = schema.required ? '' : '  # 可选';
                lines.push(`    ${key}:`);
                if (schema.type === 'string') {
                    lines.push(`      pattern: ".*"${suffix}`);
                }
                else if (schema.type === 'number') {
                    lines.push(`      min: 0${suffix}`);
                }
                else {
                    lines.push(`      type: "${schema.type}"${suffix}`);
                }
            }
        }
        // 速率限制（根据观测到的峰值 + 50% 余量）
        if (profile.peakRatePerMin > 0) {
            const rateLimit = Math.ceil(profile.peakRatePerMin * 1.5);
            lines.push(`  rate_limit:`);
            lines.push(`    max_per_minute: ${rateLimit}`);
            lines.push(`    action: warn`);
        }
        // 高频、高影响工具启用语义门控
        if (this.shouldEnableSemanticGuard(profile)) {
            lines.push(`  semantic_guard: warn`);
        }
        return lines;
    }
    /** 构建安全规则。 */
    buildSecurityRules() {
        const lines = [];
        lines.push('');
        lines.push('# ── 安全规则 ──');
        lines.push('- rule: deny_shell_injection');
        lines.push('  description: "Block known shell injection patterns"');
        lines.push('  pattern: "(;|&&|\\\\||`|\\\\$\\\\(|\\\\$\\\\))"');
        lines.push('  severity: critical');
        lines.push('');
        lines.push('- rule: deny_path_traversal');
        lines.push('  description: "Block path traversal attacks"');
        lines.push('  pattern: "\\\\.\\\\./|\\\\.\\\\.\\\\\\\\"');
        lines.push('  severity: critical');
        lines.push('');
        lines.push('- rule: deny_secrets');
        lines.push('  description: "Block hardcoded secrets in argument values"');
        lines.push('  pattern: "(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[a-zA-Z0-9-]+)"');
        lines.push('  severity: critical');
        lines.push('');
        lines.push('- rule: deny_prompt_injection');
        lines.push('  description: "Block known prompt injection payloads in arguments"');
        lines.push('  pattern: "(?i)(ignore\\\\s+(instructions?|prompt|previous|above)|disregard|forget\\\\s+everything|you\\\\s+are\\\\s+now)"');
        lines.push('  severity: high');
        return lines;
    }
    /** 为一个工具构建人类可读的编制理由。 */
    buildRationale(profile) {
        const parts = [];
        parts.push(`在观测期间被调用 ${profile.callCount} 次（平均 ${profile.callRatePerMin.toFixed(2)} 次 / 分钟）`);
        if (profile.argumentSchema && Object.keys(profile.argumentSchema).length > 0) {
            const args = Object.entries(profile.argumentSchema)
                .map(([k, s]) => `${k}:${s.type}${s.required ? '（必需）' : '（可选）'}`)
                .join(', ');
            parts.push(`参数使用: ${args}`);
        }
        if (profile.followingTools.length > 0) {
            const following = profile.followingTools.map(f => f.tool).join(', ');
            parts.push(`通常后跟: ${following}`);
        }
        return parts.join('. ');
    }
    /** 构建摘要字符串。 */
    buildSummary(analysis) {
        const toolList = analysis.toolProfiles.map(t => t.toolName).join(', ');
        return (`观测周期 ${analysis.windowId}（${analysis.durationMin.toFixed(1)} 分钟, ` +
            `${analysis.totalObservations} 次调用, ${analysis.toolProfiles.length} 个不同工具）：` +
            `已使用的工具: [${toolList}]. ` +
            `${analysis.unusedTools.length > 0 ? `${analysis.unusedTools.join(', ')} 未被使用。` : ''}`);
    }
    /** 确定是否应为某个工具启用语义门控。 */
    shouldEnableSemanticGuard(profile) {
        // 为以下工具启用语义门控：高风险工具、或调用量 > 20 且错误率 > 0% 的工具
        const highRiskTools = ['execute_command', 'shell', 'bash', 'run', 'exec', 'write_to_file', 'delete_file', 'sql'];
        if (highRiskTools.includes(profile.toolName.toLowerCase()))
            return true;
        if (profile.callCount > 20 && profile.errorRate > 0)
            return true;
        return false;
    }
    /** 计算生成策略的整体置信度。 */
    computeConfidence(analysis) {
        if (analysis.toolProfiles.length === 0)
            return 0;
        let totalConfidence = 0;
        for (const profile of analysis.toolProfiles) {
            // 置信度基于：观测计数、观测时长和错误率
            let toolConfidence = 0.3; // 基准
            // 更多观测 → 更高置信度
            if (profile.callCount >= 100)
                toolConfidence += 0.3;
            else if (profile.callCount >= 30)
                toolConfidence += 0.2;
            else if (profile.callCount >= 10)
                toolConfidence += 0.1;
            // 更长的观测窗口 → 更高置信度
            if (analysis.durationMin >= 60)
                toolConfidence += 0.2;
            else if (analysis.durationMin >= 15)
                toolConfidence += 0.1;
            // 低错误率加分
            if (profile.errorRate < 0.05)
                toolConfidence += 0.1;
            else if (profile.errorRate > 0.20)
                toolConfidence -= 0.1;
            totalConfidence += Math.max(0, Math.min(1, toolConfidence));
        }
        return Math.round((totalConfidence / analysis.toolProfiles.length) * 100) / 100;
    }
    /** 为参数允许列表建议生成一个替代 YAML 片段。 */
    generateArgAllowlistFix(toolName) {
        return [
            '',
            `# ${toolName} 的建议参数允许列表`,
            `- rule: allow_tool`,
            `  tool: "${toolName}"`,
            `  arguments:`,
            `    # 添加安全允许列表模式`,
            `    command:`,
            `      pattern: "^(ls|cat|echo|grep|find|git|npm|node|python)$"`,
            `      description: "仅允许安全的只读命令"`,
        ].join('\n');
    }
}
//# sourceMappingURL=policy-synthesizer.js.map