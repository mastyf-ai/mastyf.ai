/**
 * 蜜罐 MCP 服务器部署器——自主部署模仿真实工具的临时假 MCP 服务器，
 * 以检测对抗性探测并研究攻击者技术。
 *
 * 部署安全、隔离的蜜罐，这些蜜罐：
 *   - 记录所有工具调用以供分析
 *   - 永远不会将调用转发到真实系统
 *   - 自动超时并销毁自身
 *   - 将发现反馈到策略引擎和威胁情报网络
 */
export interface HoneypotConfig {
    /** 蜜罐的唯一名称 */
    name: string;
    /** 要模仿的服务器类型 */
    template: HoneypotTemplate;
    /** 生命周期（毫秒），之后自动销毁 */
    ttlMs: number;
    /** 要公开的工具名称（如果省略，则为模板中的所有工具） */
    exposedTools?: string[];
    /** 如果为 true，则对每个被阻止的调用发出警报 */
    alertOnInteraction: boolean;
}
export type HoneypotTemplate = 'decoy-production-database' | 'decoy-filesystem' | 'decoy-github' | 'decoy-slack' | 'decoy-api-server' | 'decoy-credentials-vault' | 'decoy-admin-panel';
export interface HoneypotInstance {
    /** 唯一的蜜罐 ID */
    id: string;
    /** 配置 */
    config: HoneypotConfig;
    /** 部署时间 */
    deployedAt: string;
    /** 过期时间 */
    expiresAt: string;
    /** 状态 */
    status: 'active' | 'expired' | 'destroyed';
    /** 记录的工具调用 */
    capturedCalls: HoneypotCapture[];
    /** 警报计数 */
    alertCount: number;
}
export interface HoneypotCapture {
    /** 调用时间戳 */
    timestamp: string;
    /** 调用的工具名称 */
    toolName: string;
    /** 提供的参数（已净化，无真实数据） */
    arguments: Record<string, unknown>;
    /** 攻击者 IP / 来源信息（如果可用） */
    source?: string;
    /** 检测到的攻击模式 */
    detectedPattern?: string;
}
export declare class HoneypotManager {
    private honeypots;
    private totalDeployments;
    private totalCaptures;
    /**
     * 使用给定配置部署一个新的蜜罐。
     */
    deploy(config: HoneypotConfig): HoneypotInstance;
    /**
     * 记录对被调用蜜罐工具的捕获。
     */
    capture(honeypotId: string, toolName: string, args: Record<string, unknown>, source?: string): HoneypotCapture | null;
    /**
     * 销毁一个蜜罐并返回捕获的数据以供分析。
     */
    destroy(honeypotId: string): HoneypotInstance | null;
    /**
     * 获取所有活跃的蜜罐。
     */
    getActive(): HoneypotInstance[];
    /**
     * 获取所有蜜罐（包括已销毁的）。
     */
    getAll(): HoneypotInstance[];
    /**
     * 获取一个特定的蜜罐。
     */
    get(honeypotId: string): HoneypotInstance | undefined;
    /**
     * 获取蜜罐的汇总信息。
     */
    getSummary(): {
        active: number;
        totalDeployments: number;
        totalCaptures: number;
        recentAlerts: number;
    };
    /**
     * 获取给定模板的工具定义。
     */
    getTemplateTools(template: HoneypotTemplate): {
        name: string;
        description: string;
    }[];
    /**
     * 净化捕获的参数以防止在日志中记录真实数据。
     */
    private sanitizeArgs;
    /**
     * 检测被调用的蜜罐工具中的攻击模式。
     */
    private detectAttackPattern;
}
//# sourceMappingURL=honeypot-manager.d.ts.map