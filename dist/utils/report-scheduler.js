/**
 * Scheduled health + security digests for Mastyf AI Autopilot.
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Logger } from './logger.js';
import { resolveTenantSwarmDir } from '../tenant/swarm-tenant-paths.js';
import { validateTenantId, DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
import { readAutopilotConfig, readLastDigestMeta, writeLastDigestMeta, } from './autopilot-config.js';
import { isAutopilotMode, applyAutopilotEnv } from './autopilot-profile.js';
import { appendLearningEvent } from './learning-events.js';
import { resolveAiPendingSuggestionsPath } from '../ai/ai-paths.js';
import { readFileSync } from 'fs';
let reportTimer = null;
let lastRunDay = '';
function digestDir(tenantId) {
    return join(resolveTenantSwarmDir(tenantId), 'digests');
}
function readSchedule() {
    const raw = process.env.MASTYF_AI_REPORT_SCHEDULE || readAutopilotConfig()?.reportSchedule || 'off';
    if (raw === 'daily' || raw === 'weekly')
        return raw;
    return 'off';
}
function cronHour() {
    const n = parseInt(process.env.MASTYF_AI_REPORT_CRON_HOUR || '', 10);
    if (Number.isFinite(n) && n >= 0 && n <= 23)
        return n;
    return readAutopilotConfig()?.reportCronHour ?? 6;
}
function shouldRunNow() {
    const schedule = readSchedule();
    if (schedule === 'off')
        return false;
    const now = new Date();
    if (now.getHours() !== cronHour())
        return false;
    const dayKey = now.toISOString().slice(0, 10);
    if (lastRunDay === dayKey)
        return false;
    if (schedule === 'weekly' && now.getDay() !== 1)
        return false;
    return true;
}
function countPendingSuggestions(tenantId) {
    const path = resolveAiPendingSuggestionsPath(tenantId);
    if (!existsSync(path))
        return 0;
    try {
        const data = JSON.parse(readFileSync(path, 'utf-8'));
        return Array.isArray(data.suggestions) ? data.suggestions.length : 0;
    }
    catch {
        return 0;
    }
}
export async function generateDigest(historyDb, tenantId = DEFAULT_TENANT_ID, windowDays = 7) {
    const tid = validateTenantId(tenantId);
    if (!historyDb) {
        return { error: 'No history database' };
    }
    const dir = digestDir(tid);
    mkdirSync(dir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    let healthPath;
    let securityPath;
    try {
        const { buildMcpHealthReport } = await import('../ai/mcp-health-report.js');
        const report = await buildMcpHealthReport(historyDb, tid, { windowDays, useLlm: false });
        if (report?.markdown) {
            healthPath = join(dir, `health-${date}.md`);
            writeFileSync(healthPath, report.markdown, 'utf-8');
        }
    }
    catch (err) {
        Logger.warn(`[report-scheduler] Health digest failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
        const { buildExecutiveSummary } = await import('./dashboard-executive-summary.js');
        const summary = await buildExecutiveSummary(historyDb, tid, windowDays);
        const pending = countPendingSuggestions(tid);
        const payload = {
            generatedAt: new Date().toISOString(),
            tenantId: tid,
            windowDays,
            summary,
            pendingSuggestions: pending,
            message: 'Policy suggestions require human approval (MASTYF_AI_AI_AUTO_APPLY=false).',
        };
        securityPath = join(dir, `security-${date}.json`);
        writeFileSync(securityPath, JSON.stringify(payload, null, 2), 'utf-8');
    }
    catch (err) {
        Logger.warn(`[report-scheduler] Security digest failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const generatedAt = new Date().toISOString();
    writeLastDigestMeta({ generatedAt, tenantId: tid, healthPath, securityPath });
    appendLearningEvent({ type: 'digest_generated', detail: `Digest ${date} health=${!!healthPath} security=${!!securityPath}` }, tid);
    Logger.info(`[report-scheduler] Generated digest for tenant=${tid} date=${date}`);
    return { healthPath, securityPath };
}
export function getLatestDigestPaths(tenantId = DEFAULT_TENANT_ID) {
    const last = readLastDigestMeta();
    if (last?.tenantId === validateTenantId(tenantId)) {
        return {
            healthPath: last.healthPath,
            securityPath: last.securityPath,
            generatedAt: last.generatedAt,
        };
    }
    return {};
}
export async function tickReportScheduler(historyDb, tenantId) {
    if (!shouldRunNow() || !historyDb)
        return;
    const tid = validateTenantId(tenantId || readAutopilotConfig()?.tenantId || DEFAULT_TENANT_ID);
    lastRunDay = new Date().toISOString().slice(0, 10);
    await generateDigest(historyDb, tid);
}
export function startReportScheduler(historyDb, tenantId = DEFAULT_TENANT_ID) {
    applyAutopilotEnv();
    if (readSchedule() === 'off' && !isAutopilotMode())
        return;
    if (reportTimer)
        return;
    const tid = validateTenantId(tenantId);
    const checkMs = 15 * 60 * 1000;
    void tickReportScheduler(historyDb, tid);
    reportTimer = setInterval(() => {
        void tickReportScheduler(historyDb, tid);
    }, checkMs);
    if (typeof reportTimer.unref === 'function')
        reportTimer.unref();
    Logger.info(`[report-scheduler] Started (schedule=${readSchedule()}, hour=${cronHour()})`);
}
export function stopReportScheduler() {
    if (reportTimer) {
        clearInterval(reportTimer);
        reportTimer = null;
    }
}
/** Read latest digest files for API (newest by date prefix in dir). */
export function readLatestDigestArtifacts(tenantId = DEFAULT_TENANT_ID) {
    const tid = validateTenantId(tenantId);
    const last = readLastDigestMeta();
    if (!last || last.tenantId !== tid) {
        return {};
    }
    let healthMarkdown;
    let securityJson;
    if (last.healthPath && existsSync(last.healthPath)) {
        try {
            healthMarkdown = readFileSync(last.healthPath, 'utf-8');
        }
        catch {
            /* ignore */
        }
    }
    if (last?.securityPath && existsSync(last.securityPath)) {
        try {
            securityJson = JSON.parse(readFileSync(last.securityPath, 'utf-8'));
        }
        catch {
            /* ignore */
        }
    }
    return {
        healthMarkdown,
        securityJson,
        generatedAt: last?.generatedAt,
    };
}
//# sourceMappingURL=report-scheduler.js.map