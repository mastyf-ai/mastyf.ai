import { Logger } from './logger.js';

interface ControlPlaneConfig {
  url: string;
  apiKey: string;
  instanceId: string;
  instanceName?: string;
  instanceVersion?: string;
  region?: string;
  pollIntervalMs?: number;
  auditPushIntervalMs?: number;
  onPolicyUpdate?: (yaml: string, version: number) => void;
  onAuditSnapshot?: () => Promise<FleetSnapshot>;
  onLicenseUpdate?: (tier: string, features: string[], maxInstances: number) => void;
}

interface FleetSnapshot {
  totalRequests: number;
  blockedRequests: number;
  allowedRequests: number;
  flaggedRequests: number;
  topBlockedTools: Array<{ tool: string; count: number }>;
  topBlockedRules: Array<{ rule: string; count: number }>;
  avgLatencyMs: number;
}

export class ControlPlaneClient {
  private config: ControlPlaneConfig;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private auditTimer: ReturnType<typeof setInterval> | null = null;
  private registered = false;

  constructor(config: ControlPlaneConfig) {
    this.config = {
      pollIntervalMs: 30_000,
      auditPushIntervalMs: 60_000,
      ...config,
    };
  }

  async start(): Promise<void> {
    await this.sendHeartbeat();
    await this.fetchLicense();
    this.startPolicyPolling();
    this.startAuditPushing();
  }

  private async fetchLicense(): Promise<void> {
    if (!this.config.onLicenseUpdate) return;
    const result: any = await this.call('license');
    if (result?.tier) {
      this.config.onLicenseUpdate(result.tier, result.features || [], result.maxInstances || 1);
    }
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.auditTimer) clearInterval(this.auditTimer);
  }

  private async call(action: string, payload?: Record<string, unknown>): Promise<any> {
    try {
      const baseUrl = this.config.url.replace(/\/$/, '');
      const url = payload
        ? `${baseUrl}/api/v1/control`
        : `${baseUrl}/api/v1/control?action=${encodeURIComponent(action)}`;
      const res = await fetch(url, {
        method: payload ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: payload ? JSON.stringify({ action, ...payload }) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        Logger.warn(`[control-plane] ${action} failed: HTTP ${res.status} ${(err as any).error || ''}`);
        return null;
      }
      return await res.json();
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        Logger.warn(`[control-plane] ${action} unreachable: ${err.message}`);
      }
      return null;
    }
  }

  private async sendHeartbeat(): Promise<void> {
    const result = await this.call('heartbeat', {
      instanceId: this.config.instanceId,
      instanceName: this.config.instanceName || 'unnamed',
      region: this.config.region,
      version: this.config.instanceVersion || '4.1.7',
      hostname: process.env.HOSTNAME || 'localhost',
      status: 'online',
    });

    if (result?.ok) {
      this.registered = true;
      Logger.info(`[control-plane] Registered instance ${this.config.instanceId}`);
    }
  }

  private startPolicyPolling(): void {
    let lastVersion = 0;
    this.pollTimer = setInterval(async () => {
      const result: any = await this.call('policy');
      if (!result || !result.policy) return;
      if (result.version > lastVersion && result.policy) {
        lastVersion = result.version;
        Logger.info(`[control-plane] New policy version ${result.version} received`);
        if (this.config.onPolicyUpdate) {
          this.config.onPolicyUpdate(result.policy, result.version);
        }
      }
    }, this.config.pollIntervalMs);
  }

  private startAuditPushing(): void {
    this.auditTimer = setInterval(async () => {
      const snapshot = this.config.onAuditSnapshot
        ? await this.config.onAuditSnapshot()
        : await this.buildAuditSnapshot();
      await this.call('audit-push', {
        instanceId: this.config.instanceId,
        periodStart: new Date(Date.now() - this.config.auditPushIntervalMs!).toISOString(),
        periodEnd: new Date().toISOString(),
        aggregates: snapshot,
      });
    }, this.config.auditPushIntervalMs);
  }

  private async buildAuditSnapshot(): Promise<FleetSnapshot> {
    return {
      totalRequests: 0,
      blockedRequests: 0,
      allowedRequests: 0,
      flaggedRequests: 0,
      topBlockedTools: [],
      topBlockedRules: [],
      avgLatencyMs: 0,
    };
  }

  async shutdown(): Promise<void> {
    this.stop();
    await this.call('heartbeat', {
      instanceId: this.config.instanceId,
      instanceName: this.config.instanceName || 'unnamed',
      status: 'offline',
    }).catch(() => {});
  }
}

let _client: ControlPlaneClient | null = null;

export function getControlPlaneClient(): ControlPlaneClient | null {
  return _client;
}

export function createControlPlaneClient(opts?: {
  onPolicyUpdate?: (yaml: string, version: number) => void;
  onAuditSnapshot?: () => Promise<FleetSnapshot>;
  onLicenseUpdate?: (tier: string, features: string[], maxInstances: number) => void;
}): ControlPlaneClient | null {
  const url = process.env.MASTYF_AI_CONTROL_PLANE_URL;
  const apiKey = process.env.MASTYF_AI_CLOUD_API_KEY || process.env.MASTYF_AI_LICENSE_KEY;
  if (!url || !apiKey) {
    Logger.info('[control-plane] Not configured — set MASTYF_AI_CONTROL_PLANE_URL and MASTYF_AI_CLOUD_API_KEY');
    return null;
  }

  const instanceId = process.env.MASTYF_AI_INSTANCE_ID
    || `${process.env.HOSTNAME || 'localhost'}-${process.pid}`;

  _client = new ControlPlaneClient({
    url,
    apiKey,
    instanceId,
    instanceName: process.env.MASTYF_AI_INSTANCE_NAME,
    instanceVersion: process.env.npm_package_version,
    region: process.env.MASTYF_AI_REGION || process.env.MASTYF_AI_FLEET_REGION,
    onPolicyUpdate: opts?.onPolicyUpdate,
    onAuditSnapshot: opts?.onAuditSnapshot,
    onLicenseUpdate: opts?.onLicenseUpdate,
  });

  return _client;
}
