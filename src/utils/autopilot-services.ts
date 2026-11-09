/**
 * Start Autopilot background services (scheduler, reports).
 */
import type { IDatabase } from '../database/database-interface.js';
import type { McpServerConfig } from '../types.js';
import { DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
import { applyAutopilotEnv, isAutopilotMode } from './autopilot-profile.js';
import { maybeAutoStart } from './threat-discovery-scheduler.js';
import { resumeThreatDiscoveryWatchers } from './threat-discovery-runner.js';
import { startReportScheduler } from './report-scheduler.js';
import { readAutopilotConfig } from './autopilot-config.js';
import { startHealthProbeScheduler } from '../services/health-probe-scheduler.js';

export function startAutopilotServices(
  historyDb: IDatabase,
  tenantId: string = DEFAULT_TENANT_ID,
  servers: McpServerConfig[] = [],
): void {
  // A proxy fronting a single server: these belong to the parent, not to one process per tool.
  if (process.env.MASTYF_AI_FLEET_CHILD === 'true' && process.env.MASTYF_AI_AUTOPILOT_HOST !== 'true') return;
  applyAutopilotEnv();
  const cfg = readAutopilotConfig();
  const autopilot =
    isAutopilotMode()
    || process.env.MASTYF_AI_THREAT_DISCOVERY_AUTOSTART === 'true'
    || cfg?.enabled;

  if (autopilot) {
    maybeAutoStart(tenantId);
  }

  resumeThreatDiscoveryWatchers(tenantId);

  const schedule = process.env.MASTYF_AI_REPORT_SCHEDULE || cfg?.reportSchedule;
  if (schedule && schedule !== 'off') {
    startReportScheduler(historyDb, tenantId);
  }

  startHealthProbeScheduler(historyDb, servers, tenantId);
}
