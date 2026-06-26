/**
 * Register production cron tasks for industry-standard features.
 */
import type { Container } from '../container.js';
import { Logger } from './logger.js';
import { setMtxPatternProvider, loadMtxPatternsFromStore } from './mtx-threat-intel-bridge.js';
import { resetThreatIntelGuardCache } from '../policy/threat-intel-guard.js';
import { writeComplianceEvidencePdf } from '../agentic/compliance/compliance-pdf-export.js';
import { runMastyfAiBenchScorecard } from './mastyf-ai-bench.js';
import {
  ingestFleetHeartbeatIntoObservatory,
  ingestMastyfAiBenchIntoObservatory,
  ingestMtxCatalogIntoObservatory,
  ingestCloudObservatoryRelay,
} from '../agentic/observatory/observatory-ingest.js';
import {
  publishObservatorySnapshotToMesh,
  pullObservatorySnapshotsFromMesh,
} from '../agentic/observatory/observatory-mesh-relay.js';

export function registerIndustryStandardTasks(container: Container): void {
  const { agenticScheduler, threatMeshNode, industryStore, complianceEvidence, db, ecosystemObservatory } = container;

  setMtxPatternProvider(() => loadMtxPatternsFromStore(industryStore));
  resetThreatIntelGuardCache();

  if (process.env.MASTYF_AI_THREAT_MESH_ENABLED === 'true') {
    const interval = process.env.MASTYF_AI_THREAT_MESH_SYNC_INTERVAL || '15m';
    agenticScheduler.register('mtx-relay-sync', 'MTX Threat Mesh Relay Sync', interval, async () => {
      const result = await threatMeshNode.syncWithRelay();
      Logger.info(
        `[IndustryStandard] MTX relay sync: published=${result.published} pulled=${result.pulled} connected=${result.relayConnected}`,
      );
      resetThreatIntelGuardCache();
    });
  }

  if (process.env.MASTYF_AI_COMPLIANCE_CRON !== 'false') {
    const cron = process.env.MASTYF_AI_COMPLIANCE_CRON_INTERVAL || '24h';
    agenticScheduler.register('compliance-evidence', 'Compliance Evidence Collection', cron, async () => {
      const frameworks = (process.env.MASTYF_AI_COMPLIANCE_FRAMEWORKS || 'soc2,iso27001').split(',');
      for (const fw of frameworks) {
        const framework = fw.trim() as import('../agentic/compliance/control-mapper.js').ComplianceFramework;
        if (!['soc2', 'hipaa', 'pci-dss', 'fedramp', 'iso27001'].includes(framework)) continue;
        const bundle = await complianceEvidence.run(framework);
        industryStore.saveComplianceControlStatus({
          framework: bundle.framework,
          controlId: '_bundle',
          status: bundle.posture.postureScore >= 80 ? 'satisfied' : bundle.posture.postureScore >= 50 ? 'partial' : 'gap',
          evidenceJson: JSON.stringify(bundle),
          evaluatedAt: bundle.generatedAt,
        });
        if (process.env.MASTYF_AI_COMPLIANCE_PDF !== 'false') {
          const pdfPath = await writeComplianceEvidencePdf(bundle);
          Logger.info(`[IndustryStandard] Compliance PDF written: ${pdfPath}`);
        }
      }
      void db;
    });
  }

  if (process.env.MASTYF_AI_RL_SANDBOX_SYNC !== 'false') {
    agenticScheduler.register('rl-sandbox-tiers', 'RL Sandbox Tier Adjustment', '30m', async () => {
      container.sandboxEnforcer.syncFromReputationAndRl(container);
    });
  }

  const observatoryInterval = process.env.MASTYF_AI_OBSERVATORY_INGEST_INTERVAL || '1h';
  agenticScheduler.register('observatory-ingest', 'Ecosystem Observatory Telemetry Ingest', observatoryInterval, async () => {
    const scorecard = runMastyfAiBenchScorecard();
    ingestMastyfAiBenchIntoObservatory(ecosystemObservatory, {
      blockRate: scorecard.blockRate,
      falsePositiveRate: scorecard.falsePositiveRate,
      serverCount: Number(process.env.MASTYF_AI_FLEET_SERVER_COUNT ?? 1),
      mastyfAiVersion: process.env.npm_package_version,
      threatClasses: { benchmark: 1 },
    });
    ingestFleetHeartbeatIntoObservatory(ecosystemObservatory, {
      instanceCount: Number(process.env.MASTYF_AI_FLEET_INSTANCE_COUNT ?? 1),
      serverCount: Number(process.env.MASTYF_AI_FLEET_SERVER_COUNT ?? 1),
      blockRate: scorecard.blockRate,
    });
    const mtxHashes = loadMtxPatternsFromStore(industryStore);
    ingestMtxCatalogIntoObservatory(
      ecosystemObservatory,
      mtxHashes.map(hash => ({ category: 'mtx-signature', severity: hash.slice(0, 8) })),
    );
    await ingestCloudObservatoryRelay(ecosystemObservatory);
    await pullObservatorySnapshotsFromMesh(ecosystemObservatory);
    await publishObservatorySnapshotToMesh(ecosystemObservatory);
    if (process.env.MASTYF_AI_REPUTATION_MESH_SYNC !== 'false') {
      const { pullReputationEntriesFromMesh } = await import('../agentic/reputation/reputation-mesh-pull.js');
      await pullReputationEntriesFromMesh(container.reputationNetwork);
    }
    Logger.debug(`[IndustryStandard] Observatory ingest: blockRate=${scorecard.blockRate.toFixed(3)} mtx=${mtxHashes.length}`);
  });

  if (process.env.MASTYF_AI_FEDERATED_LEARNING === 'true') {
    const flInterval = process.env.MASTYF_AI_FEDERATED_SYNC_INTERVAL || '30m';
    agenticScheduler.register('federated-learning-sync', 'Federated Learning Mesh Sync + Aggregate', flInterval, async () => {
      await container.federatedLearning?.syncRemoteDeltas();
      const min = Number(process.env.MASTYF_AI_FEDERATED_LEARNING_MIN_REPORTS ?? 3);
      const result = container.federatedLearning?.aggregateDeltas(min);
      if (result?.aggregated) {
        Logger.info(`[IndustryStandard] Federated aggregate: ${result.newVersion} contributors=${result.contributorCount}`);
      }
    });
  }

  agenticScheduler.start();
  Logger.info('[IndustryStandard] Production tasks registered');
}
