/**
 * Guided setup checklist + cloud control plane status (video Feature 3).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createDatabase } from '../database/create-database.js';
import { resolveMastyfAiDbPath } from './mastyf-ai-db-path.js';
import { getOnboardingStatus } from './server-registry.js';
import { REPO_ROOT } from './swarm-artifacts.js';
import { defaultControlPlaneUrl } from '../constants/cloud-url.js';
const SETUP_DIR = join(homedir(), '.mastyf-ai');
const SETUP_FILE = join(SETUP_DIR, 'setup.json');
function readSetupFile() {
    if (!existsSync(SETUP_FILE))
        return {};
    try {
        return JSON.parse(readFileSync(SETUP_FILE, 'utf-8'));
    }
    catch {
        return {};
    }
}
export function writeSetupFile(patch) {
    mkdirSync(SETUP_DIR, { recursive: true });
    const cur = readSetupFile();
    const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    writeFileSync(SETUP_FILE, JSON.stringify(next, null, 2), 'utf-8');
    return next;
}
function maskToken(token) {
    if (!token?.trim())
        return null;
    const t = token.trim();
    if (t.length <= 12)
        return '••••••••';
    return `${t.slice(0, 12)}…`;
}
export async function probeDatabaseHealth() {
    const dbPath = resolveMastyfAiDbPath();
    const start = Date.now();
    try {
        const db = await createDatabase(dbPath);
        await db.initialize();
        await db.getDistinctScannedServers();
        await db.close();
        const latencyMs = Date.now() - start;
        const engine = dbPath.endsWith('.db') ? 'SQLite' : 'Database';
        return {
            done: true,
            engine,
            version: engine === 'SQLite' ? 'history.db' : 'connected',
            latencyMs,
        };
    }
    catch (e) {
        return {
            done: false,
            engine: 'unknown',
            version: '',
            latencyMs: null,
            error: e instanceof Error ? e.message : 'Database unreachable',
        };
    }
}
export function readCloudSetup() {
    const file = readSetupFile();
    const envUrl = process.env.MASTYF_AI_CONTROL_PLANE_URL?.trim();
    const connected = !!(envUrl || file.upstreamUrl?.includes('mastyf.ai') || file.upstreamUrl?.includes('vercel') || process.env.MASTYF_AI_CLOUD_API_KEY?.trim());
    return {
        connected,
        controlPlaneUrl: file.upstreamUrl || envUrl || defaultControlPlaneUrl(),
        ssoEnabled: file.authToken != null || process.env.MASTYF_AI_CLOUD_API_KEY != null,
        policyStrictnessPct: Number(process.env.MASTYF_AI_POLICY_STRICTNESS_PCT || '85'),
        apiKeyRotationEnabled: process.env.MASTYF_AI_CLOUD_API_KEY_ROTATION === 'true',
    };
}
export async function buildSetupStatus(projectRoot = REPO_ROOT) {
    const onboarding = await getOnboardingStatus(projectRoot);
    const file = readSetupFile();
    const dbHealth = await probeDatabaseHealth();
    const hasTraffic = onboarding.hasTraffic || onboarding.totalCalls > 0;
    const mastyfAiDone = !!(file.upstreamUrl && file.listenPort) || onboarding.configCount > 0;
    const mastyfAiConfig = {
        upstreamUrl: file.upstreamUrl || 'https://api.internal.acme.co',
        listenPort: file.listenPort ?? 8443,
        authTokenPreview: maskToken(file.authToken || process.env.MASTYF_AI_CLOUD_API_KEY),
        configured: mastyfAiDone,
        done: mastyfAiDone,
    };
    const database = {
        ...dbHealth,
        done: dbHealth.done && !dbHealth.error,
        version: dbHealth.done
            ? dbHealth.engine === 'SQLite'
                ? `SQLite — ${dbHealth.latencyMs ?? 0}ms latency`
                : `${dbHealth.version} — ${dbHealth.latencyMs ?? 0}ms latency`
            : dbHealth.version,
    };
    const proxyTraffic = {
        done: hasTraffic,
        totalCalls: onboarding.totalCalls,
        healthy: hasTraffic && onboarding.totalCalls > 0,
    };
    const cloud = readCloudSetup();
    const steps = [mastyfAiConfig.done, database.done, proxyTraffic.done];
    const completedCount = steps.filter(Boolean).length;
    return {
        available: true,
        completedCount,
        totalSteps: 3,
        mastyfAiConfig,
        database,
        proxyTraffic,
        cloud,
        onboarding,
    };
}
export function connectCloudSetup(body) {
    const url = body.controlPlaneUrl?.trim() || defaultControlPlaneUrl();
    writeSetupFile({
        upstreamUrl: url.replace(/\/$/, ''),
        listenPort: 8443,
    });
    if (body.policyStrictnessPct != null) {
        process.env.MASTYF_AI_POLICY_STRICTNESS_PCT = String(body.policyStrictnessPct);
    }
    if (body.apiKeyRotationEnabled) {
        process.env.MASTYF_AI_CLOUD_API_KEY_ROTATION = 'true';
    }
    const launchUrl = `${url.replace(/\/$/, '')}/dashboard`;
    return { ok: true, launchUrl };
}
//# sourceMappingURL=setup-status.js.map