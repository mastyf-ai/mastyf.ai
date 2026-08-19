/**
 * Socket.dev supply chain enrichment — detects typosquatting, dependency confusion,
 * malware signals, and supply chain health.
 * Falls back to heuristic detection when SOCKET_API_KEY is not set.
 */

export type SocketEnrichment = {
  packageName: string;
  socketSupplyChainScore: number; // 0-100
  socketHighAlertCount: number;
  socketFeedAvailable: boolean;
  typoSquatDetected: boolean;
  depConfusionDetected: boolean;
  highConfidenceMalware: boolean;
  malwareSignalCount: number;
  hasTrustedPublisher: boolean;
  provenanceVerified: boolean;
  totalToolCount: number;
  highRiskToolCount: number;
  mediumRiskToolCount: number;
  source: 'socket_api' | 'heuristic' | 'unavailable';
};

const SOCKET_API = 'https://api.socket.dev/v0';
const TIMEOUT_MS = 8000;
const MEMORY_CACHE = new Map<string, { data: SocketEnrichment; ts: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Known trusted publishers for MCP packages
const TRUSTED_ORGS = new Set([
  'modelcontextprotocol', 'anthropics', 'openai', 'microsoft', 'google',
  'aws', 'meta', 'vercel', 'supabase', 'prisma', 'stripe', 'sentry',
  'github', 'gitlab', 'atlassian', 'slack', 'discord', 'fastify',
  'express', 'nestjs', 'nextjs', 'remix', 'astro', 'svelte',
]);

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

function detectTyposquat(packageName: string): boolean {
  const name = packageName.replace(/^@[^/]+\//, ''); // strip scope
  const commonPackages = [
    'express', 'lodash', 'react', 'axios', 'chalk', 'commander',
    'debug', 'dotenv', 'fs-extra', 'glob', 'inquirer', 'jest',
    'moment', 'mongoose', 'multer', 'nodemon', 'passport', 'prettier',
    'promises', 'request', 'semver', 'socket.io', 'uuid', 'webpack',
    'winston', 'yargs', 'zod', 'typescript', 'eslint', 'webpack',
  ];
  for (const common of commonPackages) {
    const dist = levenshtein(name.toLowerCase(), common);
    if (dist > 0 && dist <= 2 && name.toLowerCase() !== common) {
      return true;
    }
  }
  return false;
}

function detectDepConfusion(packageName: string): boolean {
  // Real dependency confusion: a scoped package whose unscoped name collides
  // with a popular unscoped package (attacker publishes the unscoped name to
  // shadow the internal scoped one). Flagging ALL scoped packages produces
  // false positives, so only flag collisions with well-known names.
  const scoped = packageName.startsWith('@');
  if (!scoped) return false;
  const unscoped = packageName.replace(/^@[^/]+\//, '').toLowerCase();
  const popularUnscoped = [
    'express', 'lodash', 'react', 'axios', 'chalk', 'commander', 'debug',
    'dotenv', 'jest', 'moment', 'mongoose', 'multer', 'nodemon', 'passport',
    'prettier', 'request', 'semver', 'uuid', 'webpack', 'winston', 'yargs',
    'zod', 'typescript', 'eslint', 'next', 'vite', 'eslint-plugin',
  ];
  return popularUnscoped.includes(unscoped);
}

function hasTrustedPublisherCheck(packageName: string): boolean {
  const scope = packageName.match(/^@([^/]+)\//);
  if (!scope) return false;
  return TRUSTED_ORGS.has(scope[1].toLowerCase());
}

async function querySocketApi(packageName: string, version?: string): Promise<Partial<SocketEnrichment> | null> {
  const apiKey = process.env.SOCKET_API_KEY || process.env.SOCKET_DEV_API_KEY;
  if (!apiKey || !version) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(
      `${SOCKET_API}/npm/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}/score`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      },
    );
    clearTimeout(timer);
    if (!res.ok) return null;

    const data = (await res.json()) as {
      supplyChainRisk?: {
        score?: number;
        components?: Record<string, { value?: number }>;
      };
    };
    const riskScore = data.supplyChainRisk?.score;
    if (typeof riskScore !== 'number') return null;

    const components = data.supplyChainRisk?.components ?? {};
    const highAlerts = Math.round(components.supplyChainRiskIssueHigh?.value ?? 0);
    const criticalAlerts = Math.round(components.supplyChainRiskIssueCritical?.value ?? 0);
    const midAlerts = Math.round(components.supplyChainRiskIssueMid?.value ?? 0);

    return {
      socketSupplyChainScore: Math.round(riskScore * 100),
      socketHighAlertCount: highAlerts + criticalAlerts,
      socketFeedAvailable: true,
      highConfidenceMalware: criticalAlerts > 0,
      malwareSignalCount: criticalAlerts,
      totalToolCount: highAlerts + criticalAlerts + midAlerts,
      source: 'socket_api',
    };
  } catch {
    return null;
  }
}

function heuristicAnalysis(packageName: string, depCount: number): Partial<SocketEnrichment> {
  const typoSquat = detectTyposquat(packageName);
  const depConfusion = detectDepConfusion(packageName);
  const trusted = hasTrustedPublisherCheck(packageName);

  // Score based on signals
  let score = 60; // base
  if (trusted) score += 15;
  if (typoSquat) score -= 30;
  if (depConfusion) score -= 20;
  if (depCount > 50) score -= 10; // many deps = more risk
  if (depCount > 100) score -= 10;
  if (depCount <= 5) score += 10; // minimal deps = less risk
  score = Math.max(0, Math.min(100, score));

  return {
    socketSupplyChainScore: score,
    socketHighAlertCount: typoSquat ? 1 : 0,
    socketFeedAvailable: false,
    typoSquatDetected: typoSquat,
    depConfusionDetected: depConfusion,
    highConfidenceMalware: false,
    malwareSignalCount: 0,
    hasTrustedPublisher: trusted,
    provenanceVerified: false,
    totalToolCount: 0,
    highRiskToolCount: 0,
    mediumRiskToolCount: 0,
    source: 'heuristic',
  };
}

export async function enrichSocket(
  packageName: string,
  depCount: number,
  version?: string,
): Promise<SocketEnrichment> {
  const cacheKey = `${packageName}@${version ?? 'latest'}`;
  const cached = MEMORY_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const apiResult = await querySocketApi(packageName, version);
  const base = apiResult
    ? { ...heuristicAnalysis(packageName, depCount), ...apiResult, source: 'socket_api' as const }
    : heuristicAnalysis(packageName, depCount);

  const result: SocketEnrichment = {
    packageName,
    socketSupplyChainScore: base.socketSupplyChainScore ?? 50,
    socketHighAlertCount: base.socketHighAlertCount ?? 0,
    socketFeedAvailable: base.socketFeedAvailable ?? false,
    typoSquatDetected: base.typoSquatDetected ?? false,
    depConfusionDetected: base.depConfusionDetected ?? false,
    highConfidenceMalware: base.highConfidenceMalware ?? false,
    malwareSignalCount: base.malwareSignalCount ?? 0,
    hasTrustedPublisher: base.hasTrustedPublisher ?? false,
    provenanceVerified: base.provenanceVerified ?? false,
    totalToolCount: base.totalToolCount ?? 0,
    highRiskToolCount: base.highRiskToolCount ?? 0,
    mediumRiskToolCount: base.mediumRiskToolCount ?? 0,
    source: base.source ?? 'heuristic',
  };

  MEMORY_CACHE.set(cacheKey, { data: result, ts: Date.now() });
  return result;
}
