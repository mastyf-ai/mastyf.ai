import type { IncomingMessage, ServerResponse } from 'http';
import { join } from 'path';
import type { PolicyWatcher } from '../policy/policy-watcher.js';
import type { PolicyRule } from '../policy/policy-types.js';
import { available } from './dashboard-live-data.js';
import { REPO_ROOT } from './security-swarm-runner.js';

type WriteJson = (res: ServerResponse, status: number, body: unknown) => void;
type ReadBody = (req: IncomingMessage) => Promise<Record<string, unknown>>;
type SetCors = () => void;
type AssertFeature = (
  url: string,
  feature: 'swarm',
  res: ServerResponse,
  setCors: SetCors,
) => boolean;

export async function handleDashboardSecuritySwarmRoutes(params: {
  url: string;
  method: string;
  req: IncomingMessage;
  res: ServerResponse;
  requestTenantId: string;
  policyWatcher?: PolicyWatcher | null;
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
    policyWatcher,
    writeJson,
    readBody,
    setCors,
    assertFeature,
  } = params;

  if (!url.startsWith('/api/security-swarm/')) return false;
  if (!assertFeature(url, 'swarm', res, setCors)) return true;

  if (url === '/api/security-swarm/run' && method === 'POST') {
    setCors();
    const body = await readBody(req).catch(() => ({}));
    const { startSwarmAnalysis } = await import('./security-swarm-runner.js');
    const result = startSwarmAnalysis({
      full: !!(body as { full?: boolean }).full,
      tenantId: requestTenantId,
    });
    if (!result.ok) {
      writeJson(res, result.status ?? 409, {
        error: result.error,
        jobId: result.jobId,
      });
      return true;
    }
    writeJson(res, 202, { jobId: result.jobId, startedAt: result.startedAt });
    void import('./dashboard-log-writer.js').then(({ writeLogEntry }) => {
      writeLogEntry(requestTenantId, 'info', 'swarm', `Swarm analysis ${(body as { full?: boolean }).full ? 'full' : 'incremental'} analysis started`, {
        source: 'swarm',
        details: `Job ${result.jobId} started`,
        metadata: { jobId: result.jobId, full: !!(body as { full?: boolean }).full, startedAt: result.startedAt },
      });
    });
    return true;
  }

  if (url === '/api/security-swarm/status' && method === 'GET') {
    setCors();
    const { getSwarmJobStatus } = await import('./security-swarm-runner.js');
    writeJson(res, 200, getSwarmJobStatus(requestTenantId));
    return true;
  }

  if (url === '/api/security-swarm/job-log' && method === 'GET') {
    setCors();
    const { readSwarmTextArtifact, readSwarmJsonFile } = await import('./swarm-artifacts.js');
    const log = readSwarmTextArtifact('job.log', requestTenantId);
    const steps = readSwarmJsonFile<{ steps?: unknown[] }>('steps.json', requestTenantId);
    writeJson(res, 200, available({
      log: log || '',
      steps: steps?.steps ?? [],
      hasLog: !!log,
    }));
    return true;
  }

  if (
    url === '/api/security-swarm/report' ||
    url === '/api/security-swarm/report/download'
  ) {
    setCors();
    const { readAnalysisReport } = await import('./security-swarm-runner.js');
    const report = readAnalysisReport(requestTenantId);
    if (!report.ok || !report.text) {
      writeJson(res, 404, { error: report.error || 'Report not ready' });
      return true;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    if (url.endsWith('/download')) {
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="mastyf-ai-swarm-analysis.txt"',
      );
    }
    res.end(report.text);
    return true;
  }

  if (url === '/api/security-swarm/latest' && method === 'GET') {
    setCors();
    const { readSwarmLatest } = await import('./security-swarm-runner.js');
    const latest = readSwarmLatest(requestTenantId);
    if (!latest) {
      writeJson(res, 404, { error: 'latest.json not found - run analysis first' });
      return true;
    }
    writeJson(res, 200, latest);
    return true;
  }

  if (url === '/api/security-swarm/figures' && method === 'GET') {
    setCors();
    const { readFiguresManifest } = await import('./swarm-artifacts.js');
    const manifest = readFiguresManifest(requestTenantId);
    writeJson(res, 200, {
      generatedAt: manifest.generatedAt ?? null,
      figures: manifest.figures,
    });
    return true;
  }

  if (url === '/api/security-swarm/summary' && method === 'GET') {
    setCors();
    const { readSwarmSummaryMd } = await import('./security-swarm-runner.js');
    const md = readSwarmSummaryMd(requestTenantId);
    if (!md) {
      writeJson(res, 404, { error: 'summary.md not found' });
      return true;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.end(md);
    return true;
  }

  if (url === '/api/security-swarm/live-session' && method === 'GET') {
    setCors();
    const { readLiveFilesystemSession } = await import('./swarm-artifacts.js');
    const live = readLiveFilesystemSession(requestTenantId);
    if (!live) {
      writeJson(res, 404, { error: 'No live session from current analysis - run security analysis first' });
      return true;
    }
    writeJson(res, 200, live);
    return true;
  }

  if (url === '/api/security-swarm/report-json' && method === 'GET') {
    setCors();
    const { ensurePlainEnglishReport } = await import('./swarm-artifacts.js');
    const report = ensurePlainEnglishReport(requestTenantId);
    if (!report) {
      writeJson(res, 404, { error: 'report.json not found - run analysis first' });
      return true;
    }
    writeJson(res, 200, report);
    return true;
  }

  if (url === '/api/security-swarm/traffic-summary' && method === 'GET') {
    setCors();
    const { readTrafficSummary } = await import('./swarm-artifacts.js');
    const traffic = readTrafficSummary(requestTenantId);
    if (!traffic) {
      writeJson(res, 404, { error: 'traffic-summary.json not found' });
      return true;
    }
    writeJson(res, 200, traffic);
    return true;
  }

  if (url === '/api/security-swarm/user-servers' && method === 'GET') {
    setCors();
    const { readUserServersSession } = await import('./swarm-artifacts.js');
    const session = readUserServersSession(requestTenantId);
    if (!session) {
      writeJson(res, 404, { error: 'user-servers-session.json not found' });
      return true;
    }
    writeJson(res, 200, session);
    return true;
  }

  if (url === '/api/security-swarm/threat-lab-candidates' && method === 'GET') {
    setCors();
    const { readThreatLabCandidates } = await import('./swarm-artifacts.js');
    const data = readThreatLabCandidates(requestTenantId);
    if (!data) {
      writeJson(res, 404, { error: 'threat-lab-candidates.json not found' });
      return true;
    }
    writeJson(res, 200, data);
    return true;
  }

  if (url === '/api/security-swarm/threat-lab-candidates/accept' && method === 'POST') {
    setCors();
    const body = await readBody(req);
    const id = String(body.id || '').trim();
    if (!id) {
      writeJson(res, 400, { ok: false, error: 'id required' });
      return true;
    }
    const { readThreatLabCandidates, markThreatLabCandidate } = await import('./swarm-artifacts.js');
    const data = readThreatLabCandidates(requestTenantId);
    const candidate = data?.candidates?.find((c: { id: string }) => c.id === id);
    if (!candidate) {
      writeJson(res, 404, { ok: false, error: 'Threat Lab candidate not found' });
      return true;
    }
    const policyRule = candidate.policyRule as PolicyRule | undefined;
    if (!policyRule?.name) {
      writeJson(res, 400, {
        ok: false,
        error: 'Candidate has no policyRule - re-run Threat Lab or pick a candidate with a generated rule',
      });
      return true;
    }
    const { applySuggestionToPolicy } = await import('../ai/policy-applier.js');
    const policyPath = process.env['MASTYF_AI_POLICY_PATH'] || join(REPO_ROOT, 'default-policy.yaml');
    const result = await applySuggestionToPolicy(
      policyRule,
      policyPath,
      policyWatcher ?? null,
      { tenantId: requestTenantId },
    );
    if (!result.applied && result.reason !== 'duplicate') {
      writeJson(res, 400, {
        ok: false,
        error: result.reason ?? 'apply_failed',
        simulationSummary: result.simulationSummary,
      });
      return true;
    }
    markThreatLabCandidate(requestTenantId, id, 'accepted');
    writeJson(res, 200, {
      ok: true,
      status: result.reason === 'duplicate' ? 'already_present' : 'accepted',
      id,
      ruleName: policyRule.name,
    });
    return true;
  }

  if (url === '/api/security-swarm/threat-lab-candidates/reject' && method === 'POST') {
    setCors();
    const body = await readBody(req);
    const id = String(body.id || '');
    const { markThreatLabCandidate } = await import('./swarm-artifacts.js');
    markThreatLabCandidate(requestTenantId, id, 'rejected');
    writeJson(res, 200, { status: 'rejected', id });
    return true;
  }

  if (url === '/api/security-swarm/auto-corpus' && method === 'GET') {
    setCors();
    const { readAutoCorpusManifest } = await import('./swarm-artifacts.js');
    const data = readAutoCorpusManifest(requestTenantId);
    if (!data) {
      writeJson(res, 404, { error: 'auto-corpus-manifest.json not found' });
      return true;
    }
    writeJson(res, 200, data);
    return true;
  }

  return false;
}
