/**
 * Mastyf AI Autopilot — single env preset for plug-and-play operation.
 */
import { readAutopilotConfig } from './autopilot-config.js';
const AUTOPILOT_ENV = {
    MASTYF_AI_AUTOPILOT: 'true',
    DASHBOARD_ENABLED: 'true',
    MASTYF_AI_WS_ENABLED: 'true',
    MASTYF_AI_THREAT_RESEARCH_AUTO: 'true',
    SWARM_THREAT_RESEARCH_AUTO: 'true',
    MASTYF_AI_THREAT_DISCOVERY_AUTOSTART: 'true',
    MASTYF_AI_AI_ENABLED: 'true',
    MASTYF_AI_SEMANTIC_ASYNC: 'true',
    MASTYF_AI_AI_AUTO_APPLY: 'false',
    MASTYF_AI_AUTO_CORPUS_PROMOTE: 'false',
    MASTYF_AI_DASHBOARD_STRICT_LIVE: 'true',
    MASTYF_AI_REPORT_SCHEDULE: 'daily',
};
export function isAutopilotMode() {
    return process.env.MASTYF_AI_AUTOPILOT === 'true' || readAutopilotConfig()?.enabled === true;
}
/** Apply Autopilot env defaults (does not override explicitly set vars). */
export function applyAutopilotEnv(config) {
    const cfg = config ?? readAutopilotConfig();
    const schedule = cfg?.reportSchedule ?? 'daily';
    const hour = cfg?.reportCronHour ?? 6;
    for (const [key, value] of Object.entries(AUTOPILOT_ENV)) {
        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
    if (process.env.MASTYF_AI_REPORT_SCHEDULE === undefined) {
        process.env.MASTYF_AI_REPORT_SCHEDULE = schedule === 'off' ? 'off' : schedule;
    }
    if (process.env.MASTYF_AI_REPORT_CRON_HOUR === undefined) {
        process.env.MASTYF_AI_REPORT_CRON_HOUR = String(hour);
    }
    if (cfg?.policyPath && process.env.MASTYF_AI_POLICY_PATH === undefined) {
        process.env.MASTYF_AI_POLICY_PATH = cfg.policyPath;
    }
    if (cfg?.corpusEvalGate && process.env.MASTYF_AI_AUTOPILOT_CORPUS_GATE === undefined) {
        process.env.MASTYF_AI_AUTOPILOT_CORPUS_GATE = 'true';
    }
}
/** Force Autopilot env (used by `autopilot start`). */
export function forceAutopilotEnv(config) {
    const cfg = config ?? readAutopilotConfig();
    for (const [key, value] of Object.entries(AUTOPILOT_ENV)) {
        process.env[key] = value;
    }
    process.env.MASTYF_AI_REPORT_SCHEDULE = cfg?.reportSchedule === 'off' ? 'off' : (cfg?.reportSchedule || 'daily');
    process.env.MASTYF_AI_REPORT_CRON_HOUR = String(cfg?.reportCronHour ?? 6);
    if (cfg?.policyPath)
        process.env.MASTYF_AI_POLICY_PATH = cfg.policyPath;
    if (cfg?.corpusEvalGate !== false)
        process.env.MASTYF_AI_AUTOPILOT_CORPUS_GATE = 'true';
    process.env.MASTYF_AI_AUTOPILOT = 'true';
}
//# sourceMappingURL=autopilot-profile.js.map