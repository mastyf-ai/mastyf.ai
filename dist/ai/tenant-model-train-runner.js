/**
 * Dashboard-triggered tenant LoRA train job (detached tsx process).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tenantExportDir, tenantTrainJobPath } from './tenant-model-export.js';
const TRAIN_SCRIPT = join(process.cwd(), 'scripts', 'ai', 'train-tenant-model.ts');
function loadJob(tenantId) {
    const p = tenantTrainJobPath(tenantId);
    if (!existsSync(p))
        return null;
    try {
        return JSON.parse(readFileSync(p, 'utf-8'));
    }
    catch {
        return null;
    }
}
function writeJob(tenantId, job) {
    mkdirSync(tenantExportDir(tenantId), { recursive: true });
    writeFileSync(tenantTrainJobPath(tenantId), JSON.stringify(job, null, 2));
}
function readLogTail(tenantId, maxLines = 40) {
    const logPath = join(tenantExportDir(tenantId), 'train-job.log');
    if (!existsSync(logPath))
        return '';
    try {
        const lines = readFileSync(logPath, 'utf-8').trim().split('\n');
        return lines.slice(-maxLines).join('\n');
    }
    catch {
        return '';
    }
}
export function isTenantTrainJobRunning(tenantId) {
    const job = loadJob(tenantId);
    return job?.state === 'running';
}
export function getTenantTrainJobStatus(tenantId) {
    const job = loadJob(tenantId);
    if (!job) {
        return {
            jobId: '',
            tenantId,
            state: 'idle',
            startedAt: null,
            finishedAt: null,
            exitCode: null,
            error: null,
            logTail: '',
        };
    }
    return {
        jobId: String(job.jobId ?? ''),
        tenantId,
        state: job.state || 'idle',
        startedAt: job.startedAt ?? null,
        finishedAt: job.finishedAt ?? null,
        exitCode: typeof job.exitCode === 'number' ? job.exitCode : null,
        error: job.error ?? null,
        logTail: readLogTail(tenantId),
    };
}
export function startTenantTrainJob(tenantId) {
    if (isTenantTrainJobRunning(tenantId)) {
        const job = loadJob(tenantId);
        return {
            ok: false,
            error: 'Train job already running',
            status: 409,
            jobId: String(job?.jobId ?? ''),
        };
    }
    if (!existsSync(TRAIN_SCRIPT)) {
        return { ok: false, error: 'train-tenant-model.ts not found', status: 500 };
    }
    const jobId = randomUUID();
    const startedAt = new Date().toISOString();
    const logPath = join(tenantExportDir(tenantId), 'train-job.log');
    mkdirSync(tenantExportDir(tenantId), { recursive: true });
    writeFileSync(logPath, '');
    writeJob(tenantId, {
        jobId,
        state: 'running',
        startedAt,
        finishedAt: null,
        exitCode: null,
        error: null,
    });
    const child = spawn(process.execPath, ['--import', 'tsx', TRAIN_SCRIPT, '--', `--tenant=${tenantId}`], {
        cwd: process.cwd(),
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        env: { ...process.env, MASTYF_AI_TENANT_ID: tenantId },
    });
    child.unref();
    child.once('exit', (code) => {
        const existing = loadJob(tenantId);
        if (existing?.jobId !== jobId)
            return;
        writeJob(tenantId, {
            ...existing,
            state: code === 0 ? 'done' : 'failed',
            finishedAt: new Date().toISOString(),
            exitCode: code,
            error: code === 0 ? null : `Train process exited with code ${code}`,
        });
    });
    return { ok: true, jobId };
}
//# sourceMappingURL=tenant-model-train-runner.js.map