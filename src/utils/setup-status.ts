/**
 * Guided setup checklist + cloud control plane status (video Feature 3).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createDatabase } from '../database/create-database.js';
import { resolveMastyfAiDbPath } from './mastyf-ai-db-path.js';
import { getOnboardingStatus, type OnboardingStatus } from './server-registry.js';
import { REPO_ROOT } from './swarm-artifacts.js';
import { defaultControlPlaneUrl } from '../constants/cloud-url.js';

const SETUP_DIR = join(homedir(), '.mastyf-ai');
const SETUP_FILE = join(SETUP_DIR, 'setup.json');

export type MastyfAiSetupConfig = {
  upstreamUrl?: string;
  listenPort?: number;
  authToken?: string;
  updatedAt?: string;
};

export type SetupMastyfAiConfigView = {
  upstreamUrl: string;
  listenPort: number;
  authTokenPreview: string | null;
  configured: boolean;
  done: boolean;
};

export type SetupDatabaseHealth = {
  done: boolean;
  engine: string;
  version: string;
  latencyMs: number | null;
  error?: string;
};

export type SetupProxyTraffic = {
  done: boolean;
  totalCalls: number;
  healthy: boolean;
};

export type SetupCloudView = {
  connected: boolean;
  controlPlaneUrl: string | null;
  ssoEnabled: boolean;
  policyStrictnessPct: number;
  apiKeyRotationEnabled: boolean;
};

export type SetupStatusPayload = {
  available: boolean;
  completedCount: number;
  totalSteps: number;
  mastyfAiConfig: SetupMastyfAiConfigView;
  database: SetupDatabaseHealth;
  proxyTraffic: SetupProxyTraffic;
  cloud: SetupCloudView;
  onboarding: OnboardingStatus;
};

function readSetupFile(): MastyfAiSetupConfig {
  if (!existsSync(SETUP_FILE)) return {};
  try {
    return JSON.parse(readFileSync(SETUP_FILE, 'utf-8')) as MastyfAiSetupConfig;
  } catch {
    return {};
  }
}

export function writeSetupFile(patch: MastyfAiSetupConfig): MastyfAiSetupConfig {
  mkdirSync(SETUP_DIR, { recursive: true });
  const cur = readSetupFile();
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  writeFileSync(SETUP_FILE, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

function maskToken(token: string | undefined): string | null {
  if (!token?.trim()) return null;
  const t = token.trim();
  if (t.length <= 12) return '••••••••';
  return `${t.slice(0, 12)}…`;
}

export async function probeDatabaseHealth(): Promise<SetupDatabaseHealth> {
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
  } catch (e) {
    return {
      done: false,
      engine: 'unknown',
      version: '',
      latencyMs: null,
      error: e instanceof Error ? e.message : 'Database unreachable',
    };
  }
}

export function readCloudSetup(): SetupCloudView {
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

export async function buildSetupStatus(projectRoot = REPO_ROOT): Promise<SetupStatusPayload> {
  const onboarding = await getOnboardingStatus(projectRoot);
  const file = readSetupFile();
  const dbHealth = await probeDatabaseHealth();
  const hasTraffic = onboarding.hasTraffic || onboarding.totalCalls > 0;
  const mastyfAiDone = !!(file.upstreamUrl && file.listenPort) || onboarding.configCount > 0;

  const mastyfAiConfig: SetupMastyfAiConfigView = {
    upstreamUrl: file.upstreamUrl || 'https://api.internal.acme.co',
    listenPort: file.listenPort ?? 8443,
    authTokenPreview: maskToken(file.authToken || process.env.MASTYF_AI_CLOUD_API_KEY),
    configured: mastyfAiDone,
    done: mastyfAiDone,
  };

  const database: SetupDatabaseHealth = {
    ...dbHealth,
    done: dbHealth.done && !dbHealth.error,
    version: dbHealth.done
      ? dbHealth.engine === 'SQLite'
        ? `SQLite — ${dbHealth.latencyMs ?? 0}ms latency`
        : `${dbHealth.version} — ${dbHealth.latencyMs ?? 0}ms latency`
      : dbHealth.version,
  };

  const proxyTraffic: SetupProxyTraffic = {
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

export function connectCloudSetup(body: {
  controlPlaneUrl: string;
  ssoEnabled?: boolean;
  policyStrictnessPct?: number;
  apiKeyRotationEnabled?: boolean;
}): { ok: boolean; launchUrl: string } {
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
