import type { IncomingMessage, ServerResponse } from 'http';

type WriteJson = (res: ServerResponse, status: number, body: unknown) => void;
type ReadBody = (req: IncomingMessage) => Promise<Record<string, unknown>>;
type SetCors = () => void;
type AssertFeature = (
  url: string,
  feature: 'swarm',
  res: ServerResponse,
  setCors: SetCors,
) => boolean;

export async function handleDashboardThreatDiscoveryRoutes(params: {
  url: string;
  method: string;
  req: IncomingMessage;
  res: ServerResponse;
  requestTenantId: string;
  writeJson: WriteJson;
  readBody: ReadBody;
  setCors: SetCors;
  assertFeature: AssertFeature;
}): Promise<boolean> {
  const {
    url,
    method,
    req,
    res,
    requestTenantId,
    writeJson,
    readBody,
    setCors,
    assertFeature,
  } = params;

  if (!url.startsWith('/api/threat-discovery/')) return false;
  if (!assertFeature(url, 'swarm', res, setCors)) return true;

  if (url === '/api/threat-discovery/status' && method === 'GET') {
    setCors();
    const { buildThreatDiscoveryStatus } = await import('./threat-discovery-status.js');
    writeJson(res, 200, await buildThreatDiscoveryStatus(requestTenantId));
    return true;
  }

  if (url === '/api/threat-discovery/automation/summary' && method === 'GET') {
    setCors();
    const { buildThreatAutomationSummary } = await import('./threat-automation-summary.js');
    writeJson(res, 200, await buildThreatAutomationSummary(requestTenantId));
    return true;
  }

  if (url === '/api/threat-discovery/threat-lab/run' && method === 'POST') {
    setCors();
    const body = await readBody(req).catch(() => ({}));
    const mode = (body as { mode?: string }).mode === 'proactive' ? 'proactive' : 'reactive';
    const { startThreatLabJob } = await import('./threat-discovery-runner.js');
    const result = startThreatLabJob(requestTenantId, { mode });
    if (!result.ok) {
      writeJson(res, result.status ?? 409, { error: result.error, jobId: result.jobId });
      return true;
    }
    writeJson(res, 202, { jobId: result.jobId, startedAt: result.startedAt, kind: 'threat-lab' });
    return true;
  }

  if (url === '/api/threat-discovery/auto-research/run' && method === 'POST') {
    setCors();
    const { startAutoThreatResearchJob } = await import('./threat-discovery-runner.js');
    const result = startAutoThreatResearchJob(requestTenantId);
    if (!result.ok) {
      writeJson(res, result.status ?? 409, { error: result.error, jobId: result.jobId });
      return true;
    }
    writeJson(res, 202, { jobId: result.jobId, startedAt: result.startedAt, kind: 'auto-research' });
    return true;
  }

  const candidateMatch = url.match(/^\/api\/threat-discovery\/candidates\/([^/]+)$/);
  if (candidateMatch && method === 'GET') {
    setCors();
    const id = decodeURIComponent(candidateMatch[1]);
    const { readThreatLabCandidateById } = await import('./swarm-artifacts.js');
    const candidate = readThreatLabCandidateById(requestTenantId, id);
    if (!candidate) {
      writeJson(res, 404, { error: 'Candidate not found' });
      return true;
    }
    writeJson(res, 200, candidate);
    return true;
  }

  if (url === '/api/threat-discovery/scheduler/start' && method === 'POST') {
    setCors();
    try {
      const { startScheduler } = await import('./threat-discovery-scheduler.js');
      const state = startScheduler(requestTenantId);
      writeJson(res, 200, { status: 'ok', ...state });
    } catch (err) {
      writeJson(res, 500, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed to start scheduler',
      });
    }
    return true;
  }

  if (url === '/api/threat-discovery/scheduler/stop' && method === 'POST') {
    setCors();
    try {
      const { stopScheduler } = await import('./threat-discovery-scheduler.js');
      const state = stopScheduler();
      writeJson(res, 200, { status: 'ok', ...state });
    } catch (err) {
      writeJson(res, 500, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed to stop scheduler',
      });
    }
    return true;
  }

  if (url === '/api/threat-discovery/scheduler/status' && method === 'GET') {
    setCors();
    try {
      const { getSchedulerStatus } = await import('./threat-discovery-scheduler.js');
      writeJson(res, 200, getSchedulerStatus(requestTenantId));
    } catch (err) {
      writeJson(res, 500, {
        running: false,
        error: err instanceof Error ? err.message : 'Failed to read scheduler status',
      });
    }
    return true;
  }

  if (url === '/api/threat-discovery/promote/stats' && method === 'GET') {
    setCors();
    try {
      const { getPromotionStats } = await import('../ai/auto-corpus-promoter.js');
      writeJson(res, 200, await getPromotionStats());
    } catch {
      writeJson(res, 200, {
        error: 'Auto-corpus promoter not available',
        enabled: process.env['MASTYF_AI_AUTO_CORPUS_PROMOTE'] !== 'true',
      });
    }
    return true;
  }

  if (url === '/api/threat-discovery/promote/batch' && method === 'POST') {
    setCors();
    try {
      const { getPromotionStats } = await import('../ai/auto-corpus-promoter.js');
      writeJson(res, 200, await getPromotionStats());
    } catch {
      writeJson(res, 200, {
        error: 'Auto-corpus promoter not available',
        enabled: process.env['MASTYF_AI_AUTO_CORPUS_PROMOTE'] !== 'true',
      });
    }
    return true;
  }

  return false;
}
