/**
 * Dashboard API routes for Industry-Standard Roadmap features (C5–B3).
 */
import type { IncomingMessage, ServerResponse } from 'http';

type WriteJson = (res: ServerResponse, status: number, body: unknown) => void;
type ReadBody = (req: IncomingMessage) => Promise<Record<string, unknown>>;

export async function handleRoadmapApiRoutes(params: {
  url: string;
  method: string;
  req: IncomingMessage;
  res: ServerResponse;
  tenantId: string;
  writeJson: WriteJson;
  readBody: ReadBody;
  setCors: () => void;
}): Promise<boolean> {
  const { url, method, req, res, tenantId, writeJson, readBody, setCors } = params;

  if (url === '/api/agentic/policy/translate' && method === 'POST') {
    setCors();
    const body = await readBody(req);
    const direction = String(body.direction ?? 'nl-to-yaml');
    if (direction === 'yaml-to-nl') {
      const { policyToNaturalLanguage } = await import('../agentic/semantic-policy/translator.js');
      const yaml = body.yaml ? String(body.yaml) : '';
      if (!yaml.trim()) {
        writeJson(res, 400, { error: 'yaml required for yaml-to-nl' });
        return true;
      }
      const summary = await policyToNaturalLanguage(yaml, { useLlm: body.useLlm !== false });
      writeJson(res, 200, { direction, summary });
      return true;
    }
    const goal = String(body.goal ?? '').trim();
    if (!goal) {
      writeJson(res, 400, { error: 'goal required for nl-to-yaml' });
      return true;
    }
    const { naturalLanguageToPolicy } = await import('../agentic/semantic-policy/translator.js');
    const { validatePolicyRuleSafe } = await import('../ai/threat-lab.js');
    const draft = await naturalLanguageToPolicy(goal, { tenantId, skipReplay: body.skipReplay === true });
    if (!draft) {
      writeJson(res, 503, { error: 'Could not generate policy draft' });
      return true;
    }
    const validationErrors = validatePolicyRuleSafe(draft.rule);
    if (validationErrors.length) {
      writeJson(res, 422, { rejected: true, validationErrors, draft });
      return true;
    }
    writeJson(res, 200, { direction, draft });
    return true;
  }

  if (url === '/api/agentic/policy/explain' && method === 'POST') {
    setCors();
    const body = await readBody(req);
    const { explainPolicyFile, policyToNaturalLanguage } = await import('../agentic/semantic-policy/translator.js');
    if (body.yaml && typeof body.yaml === 'string') {
      const summary = await policyToNaturalLanguage(body.yaml, { useLlm: body.useLlm !== false });
      writeJson(res, 200, summary);
      return true;
    }
    const summary = await explainPolicyFile(body.policyPath ? String(body.policyPath) : undefined);
    writeJson(res, 200, summary);
    return true;
  }

  if (url === '/api/agentic/policy/draft' && method === 'POST') {
    setCors();
    const body = await readBody(req);
    const goal = String(body.goal || '').trim();
    if (!goal) {
      writeJson(res, 400, { error: 'goal required' });
      return true;
    }
    const { naturalLanguageToPolicy } = await import('../agentic/semantic-policy/translator.js');
    const draft = await naturalLanguageToPolicy(goal, { tenantId });
    if (!draft) {
      writeJson(res, 503, { error: 'Could not generate policy draft' });
      return true;
    }
    writeJson(res, 200, draft);
    return true;
  }

  if (url === '/api/agentic/policy/simulate' && method === 'POST') {
    setCors();
    const body = await readBody(req);
    const { simulatePolicyChange } = await import('../utils/policy-simulator.js');
    const rule = body.rule as import('../policy/policy-types.js').PolicyRule | undefined;
    if (!rule?.name) {
      writeJson(res, 400, { error: 'rule required' });
      return true;
    }
    const report = await simulatePolicyChange({
      draftRule: rule,
      policyPath: body.policyPath ? String(body.policyPath) : undefined,
      tenantId,
    });
    writeJson(res, 200, report);
    return true;
  }

  if (url === '/api/agentic/policy/submit-approval' && method === 'POST') {
    setCors();
    const body = await readBody(req);
    const { randomUUID } = await import('crypto');
    const { storePolicyDraft } = await import('../agentic/semantic-policy/policy-approval-store.js');
    const goal = String(body.goal ?? '');
    const rule = body.rule as import('../policy/policy-types.js').PolicyRule;
    const yaml = String(body.yaml ?? '');
    if (!rule?.name || !yaml) {
      writeJson(res, 400, { error: 'rule and yaml required' });
      return true;
    }
    const requestId = randomUUID();
    const entry = storePolicyDraft({ requestId, goal, rule, yaml });
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const container = await ensureAgenticContainer();
    container?.approvalGate.submit(
      'policy-draft',
      `Approve semantic policy draft: ${rule.name}`,
      [{
        decisionId: requestId,
        source: 'semantic-policy-translator',
        rationale: goal,
        confidence: 0.85,
        requiresApproval: true,
        suggestedAction: 'APPLY_POLICY_RULE',
        timestamp: new Date().toISOString(),
      }],
      86_400_000,
    );
    writeJson(res, 200, entry);
    return true;
  }

  if (url === '/api/agentic/policy/approve' && method === 'POST') {
    setCors();
    const body = await readBody(req);
    const requestId = String(body.requestId ?? '');
    const approved = body.approved !== false;
    const { getPolicyDraft, markPolicyDraftApproved, markPolicyDraftDenied } = await import('../agentic/semantic-policy/policy-approval-store.js');
    const draft = getPolicyDraft(requestId);
    if (!draft) {
      writeJson(res, 404, { error: 'draft not found' });
      return true;
    }
    const ok = approved ? markPolicyDraftApproved(requestId) : markPolicyDraftDenied(requestId);
    writeJson(res, ok ? 200 : 409, { requestId, status: approved ? 'approved' : 'denied', ok });
    return true;
  }

  if (url === '/api/agentic/policy/apply-approved' && method === 'POST') {
    setCors();
    const body = await readBody(req);
    const requestId = String(body.requestId ?? '');
    const { getPolicyDraft, markPolicyDraftApplied } = await import('../agentic/semantic-policy/policy-approval-store.js');
    const draft = getPolicyDraft(requestId);
    if (!draft || draft.status !== 'approved') {
      writeJson(res, 409, { error: 'draft not approved' });
      return true;
    }
    const { applySuggestionToPolicy } = await import('../ai/policy-applier.js');
    const result = await applySuggestionToPolicy(draft.rule, body.policyPath ? String(body.policyPath) : undefined, null, {
      tenantId,
      skipSimulation: false,
    });
    if (result.applied) markPolicyDraftApplied(requestId);
    writeJson(res, result.applied ? 200 : 400, { ...result, requestId });
    return true;
  }

  if (url === '/api/provenance/timeline' && method === 'GET') {
    setCors();
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const container = await ensureAgenticContainer();
    const events = container?.industryStore.listProvenanceEvents(tenantId) ?? [];
    writeJson(res, 200, { events, merkleRoot: container?.configProvenance.getMerkleRoot() ?? null });
    return true;
  }

  if (url === '/api/provenance/verify' && method === 'POST') {
    setCors();
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const { ConfigProvenanceChain } = await import('../agentic/provenance/config-provenance-chain.js');
    const container = await ensureAgenticContainer();
    const events = container?.industryStore.listProvenanceEvents(tenantId) ?? [];
    const chain = new ConfigProvenanceChain(container?.industryStore, tenantId);
    const mapped = events.map(e => ({
      eventId: e.eventId,
      actor: e.actor,
      eventType: e.eventType as import('../agentic/provenance/config-provenance-chain.js').ConfigProvenanceEventType,
      resourcePath: e.resourcePath,
      diff: e.diff,
      prevHash: e.prevHash,
      entryHash: e.entryHash,
      signature: e.signature,
      approvalId: e.approvalId,
      tenantId,
      createdAt: e.createdAt,
    }));
    writeJson(res, 200, chain.verify(mapped.reverse()));
    return true;
  }

  if (url === '/api/provenance/export' && method === 'GET') {
    setCors();
    const format = new URL(req.url ?? '/', 'http://local').searchParams.get('format') ?? 'json';
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const container = await ensureAgenticContainer();
    const events = container?.industryStore.listProvenanceEvents(tenantId) ?? [];
    const mapped = events.map(e => ({
      eventId: e.eventId,
      actor: e.actor,
      eventType: e.eventType as import('../agentic/provenance/config-provenance-chain.js').ConfigProvenanceEventType,
      resourcePath: e.resourcePath,
      diff: e.diff,
      prevHash: e.prevHash,
      entryHash: e.entryHash,
      signature: e.signature,
      approvalId: e.approvalId,
      tenantId,
      createdAt: e.createdAt,
    })).reverse();
    if (format === 'signed') {
      const { exportSignedProvenanceBundle } = await import('../agentic/provenance/provenance-export.js');
      const bundle = exportSignedProvenanceBundle(mapped, container?.configProvenance.getMerkleRoot() ?? '');
      void import('../utils/enterprise-bootstrap.js').then(({ exportSiemEvent }) =>
        exportSiemEvent('provenance_export', { eventCount: bundle.eventCount, merkleRoot: bundle.merkleRoot }),
      );
      writeJson(res, 200, bundle);
      return true;
    }
    if (format === 'tarball') {
      const { writeSignedProvenanceTarball } = await import('../agentic/provenance/provenance-export.js');
      const { tmpdir } = await import('os');
      const { join } = await import('path');
      const { readFileSync, unlinkSync } = await import('fs');
      const merkleRoot = container?.configProvenance.getMerkleRoot() ?? '';
      const tmpPath = join(tmpdir(), `provenance-${Date.now()}.tar.gz`);
      writeSignedProvenanceTarball(mapped, merkleRoot, tmpPath);
      const bytes = readFileSync(tmpPath);
      unlinkSync(tmpPath);
      res.writeHead(200, {
        'Content-Type': 'application/gzip',
        'Content-Disposition': 'attachment; filename="provenance-bundle.tar.gz"',
      });
      res.end(bytes);
      return true;
    }
    const bundle = container?.configProvenance.exportBundle(mapped) ?? { version: '1.0', events: [] };
    writeJson(res, 200, bundle);
    return true;
  }

  if (url === '/api/threat-model/generate' && method === 'POST') {
    setCors();
    const body = await readBody(req);
    const configPath = String(body.configPath || 'scenarios/real-life/proxy-filesystem-config.json');
    const { generateThreatModelFromConfig, threatModelToMarkdown } = await import('../agentic/threat-modeling/stride-linddun.js');
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const container = await ensureAgenticContainer();
    const activePolicies = Array.isArray(body.activePolicies) ? body.activePolicies.map(String) : [];
    const report = generateThreatModelFromConfig(
      configPath,
      activePolicies,
      container?.capabilityGraph,
    );
    container?.industryStore?.saveThreatModelReport?.({
      reportId: `tm-${Date.now()}`,
      title: report.title,
      configPath,
      reportJson: JSON.stringify(report),
    });
    const format = String(body.format || 'json');
    if (format === 'markdown') {
      writeJson(res, 200, { markdown: threatModelToMarkdown(report), report });
      return true;
    }
    writeJson(res, 200, report);
    return true;
  }

  if (url === '/api/agentic/fleet-chains/export' && method === 'GET') {
    setCors();
    const sessionId = new URL(req.url ?? '/', 'http://local').searchParams.get('sessionId') ?? undefined;
    const format = new URL(req.url ?? '/', 'http://local').searchParams.get('format') ?? 'json';
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const container = await ensureAgenticContainer();
    const bundle = container?.fleetChainDetector.exportSiemBundle(sessionId ?? undefined);
    if (format === 'cef' && bundle) {
      writeJson(res, 200, { cef: bundle.cef, exportedAt: bundle.exportedAt });
      return true;
    }
    writeJson(res, 200, bundle ?? {});
    return true;
  }

  if (url.startsWith('/api/agentic/biometrics/') && method === 'GET') {
    setCors();
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const container = await ensureAgenticContainer();
    if (url.endsWith('/anomalies')) {
      const anomalies = container?.behaviorFingerprint.listAnomalies() ?? [];
      writeJson(res, 200, { anomalies });
      return true;
    }
    const agentId = decodeURIComponent(url.replace('/api/agentic/biometrics/', ''));
    const fp = container?.behaviorFingerprint.getFingerprint(agentId);
    writeJson(res, 200, { fingerprint: fp });
    return true;
  }

  if (url === '/api/agentic/fleet-chains' && method === 'GET') {
    setCors();
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const container = await ensureAgenticContainer();
    writeJson(res, 200, { alerts: container?.fleetChainDetector.getAlerts() ?? [] });
    return true;
  }

  if (url === '/api/agentic/fleet-chains/graph' && method === 'GET') {
    setCors();
    const sessionId = new URL(req.url ?? '/', 'http://local').searchParams.get('sessionId') ?? undefined;
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const container = await ensureAgenticContainer();
    writeJson(res, 200, container?.fleetChainDetector.exportChainGraph(sessionId ?? undefined) ?? { nodes: [], edges: [], alerts: [] });
    return true;
  }

  if (url === '/api/agentic/digital-twin/scorecard' && method === 'POST') {
    setCors();
    const body = await readBody(req);
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const container = await ensureAgenticContainer();
    const scorecard = container?.digitalTwin.scoreSandbox({
      attacksBlocked: Number(body.attacksBlocked ?? 0),
      attacksTotal: Number(body.attacksTotal ?? 0),
      workflowsPreserved: Number(body.workflowsPreserved ?? 0),
      workflowsTotal: Number(body.workflowsTotal ?? 0),
      baselineP99Ms: Number(body.baselineP99Ms ?? 0),
      sandboxP99Ms: Number(body.sandboxP99Ms ?? 0),
      capturedReplayed: body.capturedReplayed != null ? Number(body.capturedReplayed) : undefined,
      capturedPassRate: body.capturedPassRate != null ? Number(body.capturedPassRate) : undefined,
    });
    writeJson(res, 200, scorecard ?? {});
    return true;
  }

  if (url === '/api/agentic/digital-twin/replay' && method === 'POST') {
    setCors();
    const body = await readBody(req);
    const { runDigitalTwinReplayHarness } = await import('../agentic/digital-twin/replay-harness.js');
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const container = await ensureAgenticContainer();
    const serverName = String(body.serverName ?? 'filesystem');
    const replay = await runDigitalTwinReplayHarness({
      serverName,
      draftRule: body.rule as import('../policy/policy-types.js').PolicyRule | undefined,
      policyPath: body.policyPath ? String(body.policyPath) : undefined,
      maxSamples: body.maxSamples != null ? Number(body.maxSamples) : undefined,
      useCapturedTraffic: body.useCapturedTraffic !== false,
      capturedTrafficOnly: body.capturedTrafficOnly === true,
      store: container?.industryStore,
    });
    const baselineP99 = Number(body.baselineP99Ms ?? container?.digitalTwin.getBaselineP99(serverName) ?? 100);
    const scorecard = container?.digitalTwin.scoreSandbox({
      attacksBlocked: replay.attacksBlocked,
      attacksTotal: replay.attacksTotal,
      workflowsPreserved: replay.workflowsPreserved,
      workflowsTotal: replay.workflowsTotal,
      baselineP99Ms: baselineP99,
      sandboxP99Ms: Number(body.sandboxP99Ms ?? baselineP99 + 20),
      capturedReplayed: replay.capturedReplayed,
      capturedPassRate: replay.capturedPassRate,
    });
    writeJson(res, 200, { replay, scorecard });
    return true;
  }

  if (url === '/api/agentic/zero-trust/score' && method === 'POST') {
    setCors();
    const body = await readBody(req);
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const { getActiveSpiffeId } = await import('../utils/mtls-config.js');
    const container = await ensureAgenticContainer();
    const score = container?.zeroTrustEngine.score({
      agentId: String(body.agentId ?? 'unknown'),
      sessionId: String(body.sessionId ?? 'unknown'),
      serverName: String(body.serverName ?? 'unknown'),
      toolName: String(body.toolName ?? 'unknown'),
      authenticated: Boolean(body.authenticated),
      spiffeId: body.spiffeId ? String(body.spiffeId) : getActiveSpiffeId(),
      credentialIdentity: body.credentialIdentity ? String(body.credentialIdentity) : undefined,
    });
    writeJson(res, 200, score ?? {});
    return true;
  }

  if (url === '/api/agentic/reputation/query' && method === 'POST') {
    setCors();
    const body = await readBody(req);
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const container = await ensureAgenticContainer();
    const serverName = String(body.serverName ?? '');
    const useNetwork = body.networkFetch !== false;
    const entry = useNetwork
      ? await container?.reputationNetwork.queryWithNetwork(
          serverName,
          body.packageName ? String(body.packageName) : undefined,
        )
      : container?.reputationNetwork.queryServerReputation(
          serverName,
          body.packageName ? String(body.packageName) : undefined,
        );
    if (body.publishToMesh) {
      const pub = await container?.reputationNetwork.publishToMeshRelay(
        serverName,
        body.packageName ? String(body.packageName) : undefined,
      );
      writeJson(res, 200, { entry, meshPublish: pub });
      return true;
    }
    writeJson(res, 200, { entry });
    return true;
  }

  if (url === '/api/agentic/reputation/sync-mesh' && method === 'POST') {
    setCors();
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const { pullReputationEntriesFromMesh } = await import('../agentic/reputation/reputation-mesh-pull.js');
    const container = await ensureAgenticContainer();
    const ingested = container ? await pullReputationEntriesFromMesh(container.reputationNetwork) : 0;
    writeJson(res, 200, { ingested });
    return true;
  }

  if (url === '/api/agentic/reputation/bundle' && method === 'GET') {
    setCors();
    const serverName = new URL(req.url ?? '/', 'http://local').searchParams.get('server') ?? '';
    const packageName = new URL(req.url ?? '/', 'http://local').searchParams.get('package') ?? undefined;
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const { exportReputationAttestationBundle } = await import('../agentic/reputation/reputation-mesh-pull.js');
    const container = await ensureAgenticContainer();
    const bundle = container && serverName
      ? exportReputationAttestationBundle(container.reputationNetwork, serverName, packageName ?? undefined)
      : { entry: null, votes: [] };
    writeJson(res, 200, bundle);
    return true;
  }

  if (url === '/api/agentic/observatory/sync-mesh' && method === 'POST') {
    setCors();
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const { publishObservatorySnapshotToMesh, pullObservatorySnapshotsFromMesh } = await import('../agentic/observatory/observatory-mesh-relay.js');
    const container = await ensureAgenticContainer();
    if (!container) {
      writeJson(res, 503, { error: 'container_unavailable' });
      return true;
    }
    const pulled = await pullObservatorySnapshotsFromMesh(container.ecosystemObservatory);
    const published = await publishObservatorySnapshotToMesh(container.ecosystemObservatory);
    writeJson(res, 200, { pulled, published: published.ok });
    return true;
  }

  if (url === '/api/agentic/observatory/snapshot' && method === 'GET') {
    setCors();
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const container = await ensureAgenticContainer();
    const useCloud = new URL(req.url ?? '/', 'http://local').searchParams.get('cloud') === 'true';
    if (useCloud) {
      const { pullCloudObservatorySnapshot } = await import('../agentic/observatory/observatory-cloud-relay.js');
      const cloud = await pullCloudObservatorySnapshot();
      writeJson(res, 200, container?.ecosystemObservatory.snapshotWithCloud(cloud ?? undefined) ?? {});
      return true;
    }
    writeJson(res, 200, container?.ecosystemObservatory.snapshot() ?? {});
    return true;
  }

  if (url === '/api/agentic/observatory/ingest-cloud' && method === 'POST') {
    setCors();
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const { ingestCloudObservatoryRelay } = await import('../agentic/observatory/observatory-ingest.js');
    const container = await ensureAgenticContainer();
    const result = container
      ? await ingestCloudObservatoryRelay(container.ecosystemObservatory)
      : { ingested: 0, cloudAvailable: false };
    writeJson(res, 200, result);
    return true;
  }

  if (url === '/api/agentic/observatory/alerts' && method === 'GET') {
    setCors();
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const container = await ensureAgenticContainer();
    const evaluate = new URL(req.url ?? '/', 'http://local').searchParams.get('evaluate') === 'true';
    const fresh = evaluate ? container?.ecosystemObservatory.evaluateProactiveAlerts() ?? [] : [];
    const persisted = container?.ecosystemObservatory.listAlerts() ?? [];
    writeJson(res, 200, { alerts: [...fresh, ...persisted].slice(0, 50) });
    return true;
  }

  if (url === '/api/agentic/insurance/quantify' && method === 'POST') {
    setCors();
    const body = await readBody(req);
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const container = await ensureAgenticContainer();
    const report = container?.insuranceRiskQuantifier.quantify({
      tenantId,
      serverName: String(body.serverName ?? 'unknown'),
      toolCount: Number(body.toolCount ?? 10),
      networkExposure: Number(body.networkExposure ?? 0.5),
      recordsAtRisk: Number(body.recordsAtRisk ?? 1000),
      avgRecordValueUsd: body.avgRecordValueUsd != null ? Number(body.avgRecordValueUsd) : undefined,
    });
    writeJson(res, 200, report ?? {});
    return true;
  }

  if (url === '/api/agentic/insurance/export-pdf' && method === 'POST') {
    setCors();
    const body = await readBody(req);
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const container = await ensureAgenticContainer();
    const report = container?.insuranceRiskQuantifier.quantify({
      tenantId,
      serverName: String(body.serverName ?? 'unknown'),
      toolCount: Number(body.toolCount ?? 10),
      networkExposure: Number(body.networkExposure ?? 0.5),
      recordsAtRisk: Number(body.recordsAtRisk ?? 1000),
      avgRecordValueUsd: body.avgRecordValueUsd != null ? Number(body.avgRecordValueUsd) : undefined,
    });
    if (!report) {
      writeJson(res, 503, { error: 'Could not quantify risk' });
      return true;
    }
    const { writeInsuranceRiskPdf } = await import('../agentic/insurance/insurance-pdf-export.js');
    const pdf = writeInsuranceRiskPdf(report);
    writeJson(res, 200, { report, ...pdf });
    return true;
  }

  if (url === '/api/agentic/federated/status' && method === 'GET') {
    setCors();
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const container = await ensureAgenticContainer();
    writeJson(res, 200, {
      enabled: container?.federatedLearning?.isEnabled() ?? false,
      activeVersion: container?.federatedLearning?.getActiveVersion() ?? 'baseline-v1',
      stats: container?.federatedLearning?.getStats() ?? {},
    });
    return true;
  }

  if (url === '/api/agentic/federated/aggregate' && method === 'POST') {
    setCors();
    const body = await readBody(req);
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const container = await ensureAgenticContainer();
    if (body.syncRemote !== false) {
      await container?.federatedLearning?.syncRemoteDeltas();
    }
    const minContributors = Number(body.minContributors ?? 3);
    const result = container?.federatedLearning?.aggregateDeltas(minContributors) ?? { aggregated: false, contributorCount: 0 };
    writeJson(res, 200, result);
    return true;
  }

  if (url === '/api/agentic/federated/infer' && method === 'POST') {
    setCors();
    const body = await readBody(req);
    const features = Array.isArray(body.features) ? body.features.map(Number) : [];
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const container = await ensureAgenticContainer();
    const result = await container?.federatedLearning?.runOnnxInference(features);
    writeJson(res, 200, { result });
    return true;
  }

  if (url === '/api/agentic/federated/submit-delta' && method === 'POST') {
    setCors();
    const body = await readBody(req);
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const container = await ensureAgenticContainer();
    const delta = container?.federatedLearning?.submitLocalDelta({
      signatureHash: String(body.signatureHash ?? ''),
      sampleCount: Number(body.sampleCount ?? 0),
      privacyBudgetEpsilon: body.privacyBudgetEpsilon != null ? Number(body.privacyBudgetEpsilon) : undefined,
    });
    writeJson(res, delta ? 200 : 503, { delta });
    return true;
  }

  if (url === '/api/agentic/federated/promote-rollout' && method === 'POST') {
    setCors();
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const container = await ensureAgenticContainer();
    const decision = container?.federatedLearning?.promoteRolloutStage() ?? null;
    writeJson(res, decision ? 200 : 400, { decision, stage: container?.federatedLearning?.getRolloutStage() });
    return true;
  }

  if (url === '/api/agentic/federated/export' && method === 'GET') {
    setCors();
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const container = await ensureAgenticContainer();
    writeJson(res, 200, container?.federatedLearning?.exportModelBundle() ?? {});
    return true;
  }

  if (url === '/api/agentic/federated/import' && method === 'POST') {
    setCors();
    const body = await readBody(req);
    const { ensureAgenticContainer } = await import('../utils/agentic-container.js');
    const container = await ensureAgenticContainer();
    const weights = Array.isArray(body.weights) ? body.weights.map(Number) : [];
    container?.federatedLearning?.importModelBundle({
      modelVersion: String(body.modelVersion ?? `import-${Date.now()}`),
      weights,
    });
    writeJson(res, 200, { ok: true, modelVersion: body.modelVersion });
    return true;
  }

  if (url === '/api/agentic/plan-compliance/audit' && method === 'GET') {
    setCors();
    try {
      const { runPlanComplianceAudit } = await import('../agentic/plan-compliance-audit.js');
      const report = await runPlanComplianceAudit();
      writeJson(res, 200, report);
    } catch (err: unknown) {
      writeJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
        overallScore: 0,
        productionReady: false,
        modules: [],
        generatedAt: new Date().toISOString(),
        summary: 'Plan compliance audit failed',
      });
    }
    return true;
  }

  return false;
}
