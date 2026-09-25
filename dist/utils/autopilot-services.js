import { DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
import { applyAutopilotEnv, isAutopilotMode } from './autopilot-profile.js';
import { maybeAutoStart } from './threat-discovery-scheduler.js';
import { resumeThreatDiscoveryWatchers } from './threat-discovery-runner.js';
import { startReportScheduler } from './report-scheduler.js';
import { readAutopilotConfig } from './autopilot-config.js';
import { startHealthProbeScheduler } from '../services/health-probe-scheduler.js';
export function startAutopilotServices(historyDb, tenantId = DEFAULT_TENANT_ID, servers = []) {
    applyAutopilotEnv();
    const cfg = readAutopilotConfig();
    const autopilot = isAutopilotMode()
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
//# sourceMappingURL=autopilot-services.js.map