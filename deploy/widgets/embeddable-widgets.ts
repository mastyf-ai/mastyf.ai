/** Embeddable Mastyf AI dashboard widgets for external monitoring dashboards. */

export interface WidgetConfig {
  apiBase: string;
  serverName?: string;
  tenantId?: string;
  refreshIntervalMs?: number;
  width?: number;
  height?: number;
  theme?: 'light' | 'dark';
}

export interface MetricsSnapshot {
  totalRequests: number;
  blockedRequests: number;
  blockRate: number;
  activeSessions: number;
  activeProxies: number;
  avgLatencyMs: number;
  redisAvailable: boolean;
  semanticOnline: boolean;
  updatedAt: string;
}

export interface AuditSummary {
  totalEvents: number;
  blockedEvents: number;
  allowedEvents: number;
  flaggedEvents: number;
  topBlockedTools: Array<{ tool: string; count: number }>;
  topBlockedRules: Array<{ rule: string; count: number }>;
  periodStart: string;
  periodEnd: string;
}

export async function fetchMetricsSnapshot(config: WidgetConfig): Promise<MetricsSnapshot> {
  const base = config.apiBase.replace(/\/$/, '');
  const res = await fetch(`${base}/api/aggregate/metrics?window=1h`, {
    headers: { 'X-Tenant-Id': config.tenantId || 'default' },
  });
  if (!res.ok) throw new Error(`Metrics fetch failed: ${res.status}`);

  const data = await res.json();
  return {
    totalRequests: data.totalRequests || 0,
    blockedRequests: data.blockedRequests || 0,
    blockRate: data.totalRequests ? (data.blockedRequests / data.totalRequests) * 100 : 0,
    activeSessions: data.activeSessions || 0,
    activeProxies: data.activeProxies || 0,
    avgLatencyMs: data.avgLatencyMs || 0,
    redisAvailable: data.redisAvailable || false,
    semanticOnline: data.semanticOnline || false,
    updatedAt: new Date().toISOString(),
  };
}

export async function fetchAuditSummary(config: WidgetConfig): Promise<AuditSummary> {
  const base = config.apiBase.replace(/\/$/, '');
  const res = await fetch(`${base}/api/aggregate/audit?window=24h&limit=1000`, {
    headers: { 'X-Tenant-Id': config.tenantId || 'default' },
  });
  if (!res.ok) throw new Error(`Audit fetch failed: ${res.status}`);

  const data = await res.json();
  const events = data.events || [];

  const blocked = events.filter((e: any) => e.decision === 'block');
  const allowed = events.filter((e: any) => e.decision === 'pass');
  const flagged = events.filter((e: any) => e.decision === 'flag');

  const toolCounts = new Map<string, number>();
  const ruleCounts = new Map<string, number>();
  for (const e of blocked) {
    toolCounts.set(e.toolName, (toolCounts.get(e.toolName) || 0) + 1);
    if (e.rule) ruleCounts.set(e.rule, (ruleCounts.get(e.rule) || 0) + 1);
  }

  return {
    totalEvents: events.length,
    blockedEvents: blocked.length,
    allowedEvents: allowed.length,
    flaggedEvents: flagged.length,
    topBlockedTools: [...toolCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tool, count]) => ({ tool, count })),
    topBlockedRules: [...ruleCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([rule, count]) => ({ rule, count })),
    periodStart: data.periodStart || '',
    periodEnd: data.periodEnd || '',
  };
}

export function renderBlockRateWidget(container: HTMLElement, metrics: MetricsSnapshot, config: WidgetConfig): void {
  const blocked = metrics.blockedRequests;
  const total = metrics.totalRequests;
  const rate = metrics.blockRate.toFixed(1);

  const theme = config.theme === 'dark' ? darkTheme : lightTheme;

  container.innerHTML = `
    <div style="${widgetContainerStyle(theme, config)}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <span style="font-size:14px;color:${theme.textSecondary};">Block Rate</span>
        <span style="font-size:12px;color:${theme.textMuted};">Last hour</span>
      </div>
      <div style="font-size:48px;font-weight:700;color:${blocked > 0 ? theme.danger : theme.success};line-height:1;">
        ${rate}%
      </div>
      <div style="font-size:12px;color:${theme.textMuted};margin-top:8px;">
        ${blocked} blocked / ${total} total requests
      </div>
      ${blocked > 0 ? `
        <div style="margin-top:16px;background:${theme.bgMuted};border-radius:4px;height:4px;">
          <div style="width:${rate}%;background:${theme.danger};height:100%;border-radius:4px;transition:width 0.3s;"></div>
        </div>
      ` : `
        <div style="margin-top:16px;padding:8px;background:${theme.successBg};color:${theme.success};border-radius:4px;font-size:12px;text-align:center;">
          No attacks blocked
        </div>
      `}
    </div>`;
}

export function renderSystemStatusWidget(container: HTMLElement, metrics: MetricsSnapshot, config: WidgetConfig): void {
  const theme = config.theme === 'dark' ? darkTheme : lightTheme;

  const items = [
    { label: 'Redis', ok: metrics.redisAvailable },
    { label: 'Semantic LLM', ok: metrics.semanticOnline },
    { label: 'Latency', ok: metrics.avgLatencyMs < 500, value: `${metrics.avgLatencyMs.toFixed(0)}ms` },
    { label: 'Active Proxies', ok: metrics.activeProxies > 0, value: `${metrics.activeProxies}` },
  ];

  container.innerHTML = `
    <div style="${widgetContainerStyle(theme, config)}">
      <div style="font-size:14px;color:${theme.textSecondary};margin-bottom:12px;">System Status</div>
      ${items.map(i => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid ${theme.border};">
          <span style="font-size:13px;color:${theme.textPrimary};">${i.label}</span>
          <span style="font-size:13px;font-weight:500;color:${i.ok ? theme.success : theme.danger};">
            ${i.ok ? (i.value || 'OK') : (i.value || 'DOWN')}
          </span>
        </div>
      `).join('')}
    </div>`;
}

export function renderTopBlockedToolsWidget(container: HTMLElement, audit: AuditSummary, config: WidgetConfig): void {
  const theme = config.theme === 'dark' ? darkTheme : lightTheme;

  const tools = audit.topBlockedTools.slice(0, 5);

  container.innerHTML = `
    <div style="${widgetContainerStyle(theme, config)}">
      <div style="font-size:14px;color:${theme.textSecondary};margin-bottom:12px;">Top Blocked Tools</div>
      ${tools.length === 0
        ? `<div style="text-align:center;color:${theme.textMuted};padding:16px;">No blocks in last 24h</div>`
        : tools.map((t, i) => `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <span style="font-size:11px;color:${theme.textMuted};min-width:16px;">#${i + 1}</span>
            <span style="font-size:13px;color:${theme.textPrimary};flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.tool}</span>
            <span style="font-size:12px;font-weight:600;color:${theme.danger};">${t.count}</span>
          </div>
        `).join('')
      }
    </div>`;
}

const lightTheme = {
  bg: '#ffffff',
  bgMuted: '#f3f4f6',
  textPrimary: '#111827',
  textSecondary: '#6b7280',
  textMuted: '#9ca3af',
  border: '#e5e7eb',
  danger: '#dc2626',
  dangerBg: '#fef2f2',
  success: '#16a34a',
  successBg: '#f0fdf4',
  warning: '#d97706',
};

const darkTheme = {
  bg: '#1f2937',
  bgMuted: '#374151',
  textPrimary: '#f9fafb',
  textSecondary: '#d1d5db',
  textMuted: '#9ca3af',
  border: '#4b5563',
  danger: '#ef4444',
  dangerBg: '#450a0a',
  success: '#22c55e',
  successBg: '#052e16',
  warning: '#f59e0b',
};

function widgetContainerStyle(theme: typeof lightTheme, config: WidgetConfig): string {
  return `
    background:${theme.bg};
    border:1px solid ${theme.border};
    border-radius:8px;
    padding:16px;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    max-width:${config.width || 400}px;
    min-height:${config.height || 120}px;
    box-sizing:border-box;
  `;
}

export class MastyfWidget {
  private container: HTMLElement;
  private config: WidgetConfig;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(container: HTMLElement, config: WidgetConfig) {
    this.container = container;
    this.config = {
      refreshIntervalMs: 15000,
      theme: 'light',
      ...config,
    };
  }

  async start(type: 'block-rate' | 'system-status' | 'top-blocked-tools'): Promise<void> {
    const refresh = async () => {
      try {
        const metrics = await fetchMetricsSnapshot(this.config);

        switch (type) {
          case 'block-rate':
            renderBlockRateWidget(this.container, metrics, this.config);
            break;
          case 'system-status':
            renderSystemStatusWidget(this.container, metrics, this.config);
            break;
          case 'top-blocked-tools': {
            const audit = await fetchAuditSummary(this.config);
            renderTopBlockedToolsWidget(this.container, audit, this.config);
            break;
          }
        }
      } catch (err) {
        this.container.innerHTML = `<div style="color:#dc2626;font-size:12px;padding:16px;">Widget unavailable: ${err instanceof Error ? err.message : 'Unknown error'}</div>`;
      }
    };

    await refresh();
    this.interval = setInterval(refresh, this.config.refreshIntervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}

if (typeof window !== 'undefined') {
  (window as any).MastyfWidget = MastyfWidget;
}
