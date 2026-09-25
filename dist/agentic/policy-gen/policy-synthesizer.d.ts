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
import type { AnalysisResult } from './pattern-analyzer.js';
export interface SynthesizedPolicy {
    /** MCP Mastyf AI 格式的完整 YAML 策略 */
    yaml: string;
    /** 人类可读的变更摘要 */
    summary: string;
    /** 按工具划分的详细策略编制理由 */
    rationale: Record<string, string>;
    /** 应用于该策略的置信度分数（0–1） */
    confidence: number;
    /** 提供更优策略的可行建议 */
    suggestions: PolicySuggestion[];
    /** 生成的策略信息 */
    metadata: PolicyMetadata;
}
export interface PolicySuggestion {
    severity: 'high' | 'medium' | 'low' | 'info';
    category: 'tool_access' | 'rate_limit' | 'argument_restriction' | 'security' | 'workflow';
    description: string;
    recommendation: string;
    /** 如果用户批准，可以自动应用的修补策略 YAML 片段 */
    autoFixYaml?: string;
}
export interface PolicyMetadata {
    generatedAt: string;
    generatorVersion: string;
    observationWindowId: string;
    totalToolsObserved: number;
    toolsInPolicy: number;
    toolsWithRateLimits: number;
    toolsWithSemanticGuard: number;
    securityRulesGenerated: number;
}
export declare class PolicySynthesizer {
    private readonly version;
    /**
     * 从分析结果中合成完整的 MCP Mastyf AI 策略。
     */
    synthesize(analysis: AnalysisResult): SynthesizedPolicy;
    /** 为单个工具构建规则行。 */
    private buildToolRule;
    /** 构建安全规则。 */
    private buildSecurityRules;
    /** 为一个工具构建人类可读的编制理由。 */
    private buildRationale;
    /** 构建摘要字符串。 */
    private buildSummary;
    /** 确定是否应为某个工具启用语义门控。 */
    private shouldEnableSemanticGuard;
    /** 计算生成策略的整体置信度。 */
    private computeConfidence;
    /** 为参数允许列表建议生成一个替代 YAML 片段。 */
    private generateArgAllowlistFix;
}
//# sourceMappingURL=policy-synthesizer.d.ts.map