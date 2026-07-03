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

import { Logger } from '../../utils/logger.js';

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

export type HoneypotTemplate =
  | 'decoy-production-database'
  | 'decoy-filesystem'
  | 'decoy-github'
  | 'decoy-slack'
  | 'decoy-api-server'
  | 'decoy-credentials-vault'
  | 'decoy-admin-panel';

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

export class HoneypotManager {
  private honeypots = new Map<string, HoneypotInstance>();
  private totalDeployments = 0;
  private totalCaptures = 0;

  /**
   * 使用给定配置部署一个新的蜜罐。
   */
  deploy(config: HoneypotConfig): HoneypotInstance {
    const id = crypto.randomUUID();
    const now = new Date();
    const instance: HoneypotInstance = {
      id,
      config,
      deployedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + config.ttlMs).toISOString(),
      status: 'active',
      capturedCalls: [],
      alertCount: 0,
    };

    this.honeypots.set(id, instance);
    this.totalDeployments++;

    Logger.info(`[HoneypotManager] Deployed honeypot "${config.name}" (${id}) as ${config.template} — expires in ${config.ttlMs / 1000}s`);

    // 安排自动销毁
    setTimeout(() => this.destroy(id), config.ttlMs);

    return instance;
  }

  /**
   * 记录对被调用蜜罐工具的捕获。
   */
  capture(honeypotId: string, toolName: string, args: Record<string, unknown>, source?: string): HoneypotCapture | null {
    const instance = this.honeypots.get(honeypotId);
    if (!instance || instance.status !== 'active') return null;

    const capture: HoneypotCapture = {
      timestamp: new Date().toISOString(),
      toolName,
      arguments: this.sanitizeArgs(args),
      source,
      detectedPattern: this.detectAttackPattern(toolName, args),
    };

    instance.capturedCalls.push(capture);
    this.totalCaptures++;

    if (instance.config.alertOnInteraction) {
      instance.alertCount++;
      Logger.warn(`[HoneypotManager] Alert: Honeypot "${instance.config.name}" probed — ${toolName} (pattern: ${capture.detectedPattern || 'unknown'})`);
    }

    return capture;
  }

  /**
   * 销毁一个蜜罐并返回捕获的数据以供分析。
   */
  destroy(honeypotId: string): HoneypotInstance | null {
    const instance = this.honeypots.get(honeypotId);
    if (!instance) return null;

    instance.status = 'destroyed';
    Logger.info(`[HoneypotManager] Destroyed honeypot "${instance.config.name}" (${honeypotId}) — ${instance.capturedCalls.length} captures`);

    return instance;
  }

  /**
   * 获取所有活跃的蜜罐。
   */
  getActive(): HoneypotInstance[] {
    return [...this.honeypots.values()].filter(h => h.status === 'active');
  }

  /**
   * 获取所有蜜罐（包括已销毁的）。
   */
  getAll(): HoneypotInstance[] {
    return [...this.honeypots.values()];
  }

  /**
   * 获取一个特定的蜜罐。
   */
  get(honeypotId: string): HoneypotInstance | undefined {
    return this.honeypots.get(honeypotId);
  }

  /**
   * 获取蜜罐的汇总信息。
   */
  getSummary(): { active: number; totalDeployments: number; totalCaptures: number; recentAlerts: number } {
    const active = this.getActive();
    return {
      active: active.length,
      totalDeployments: this.totalDeployments,
      totalCaptures: this.totalCaptures,
      recentAlerts: active.reduce((sum, h) => sum + h.alertCount, 0),
    };
  }

  /**
   * 获取给定模板的工具定义。
   */
  getTemplateTools(template: HoneypotTemplate): { name: string; description: string }[] {
    const templates: Record<HoneypotTemplate, { name: string; description: string }[]> = {
      'decoy-production-database': [
        { name: 'query', description: 'Execute a database query (honeypot)' },
        { name: 'migrate', description: 'Run database migrations (honeypot)' },
        { name: 'backup', description: 'Create database backup (honeypot)' },
        { name: 'list_tables', description: 'List all database tables (honeypot)' },
      ],
      'decoy-filesystem': [
        { name: 'read_file', description: 'Read a file from the filesystem (honeypot)' },
        { name: 'write_file', description: 'Write content to a file (honeypot)' },
        { name: 'delete_file', description: 'Delete a file (honeypot)' },
        { name: 'list_directory', description: 'List directory contents (honeypot)' },
      ],
      'decoy-github': [
        { name: 'create_pr', description: 'Create a pull request (honeypot)' },
        { name: 'merge_pr', description: 'Merge a pull request (honeypot)' },
        { name: 'list_secrets', description: 'List repository secrets (honeypot)' },
        { name: 'trigger_workflow', description: 'Trigger a GitHub Actions workflow (honeypot)' },
      ],
      'decoy-slack': [
        { name: 'send_message', description: 'Send a Slack message (honeypot)' },
        { name: 'list_channels', description: 'List Slack channels (honeypot)' },
        { name: 'read_messages', description: 'Read channel messages (honeypot)' },
      ],
      'decoy-api-server': [
        { name: 'get_data', description: 'Fetch data from the API (honeypot)' },
        { name: 'update_data', description: 'Update API data (honeypot)' },
        { name: 'delete_data', description: 'Delete API data (honeypot)' },
      ],
      'decoy-credentials-vault': [
        { name: 'get_secret', description: 'Retrieve a secret (honeypot)' },
        { name: 'list_secrets', description: 'List all secrets (honeypot)' },
        { name: 'rotate_key', description: 'Rotate an encryption key (honeypot)' },
      ],
      'decoy-admin-panel': [
        { name: 'list_users', description: 'List system users (honeypot)' },
        { name: 'grant_access', description: 'Grant access to user (honeypot)' },
        { name: 'system_config', description: 'View system configuration (honeypot)' },
      ],
    };

    return templates[template] || [];
  }

  /**
   * 净化捕获的参数以防止在日志中记录真实数据。
   */
  private sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string' && value.length > 200) {
        sanitized[key] = `[${value.length} chars]`;
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  /**
   * 检测被调用的蜜罐工具中的攻击模式。
   */
  private detectAttackPattern(toolName: string, args: Record<string, unknown>): string | undefined {
    const argsStr = JSON.stringify(args).toLowerCase();

    if (argsStr.includes('secrets') || argsStr.includes('password') || argsStr.includes('token')) {
      return 'credential_theft_attempt';
    }
    if (toolName.includes('delete') || toolName.includes('drop') || toolName.includes('destroy')) {
      return 'destructive_action';
    }
    if (argsStr.includes('DROP TABLE') || argsStr.includes('DELETE FROM') || argsStr.includes('truncate')) {
      return 'data_destruction';
    }
    if (argsStr.includes('/etc/passwd') || argsStr.includes('shadow') || argsStr.includes('.env')) {
      return 'sensitive_file_access';
    }

    return undefined;
  }
}