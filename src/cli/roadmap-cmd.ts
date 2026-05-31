/**
 * CLI: guardian roadmap — industry-standard A1–C5 utilities.
 */
import { writeFileSync, readFileSync } from 'fs';
import { HistoryDatabase } from '../database/history-db.js';
import { IndustryStandardStore } from '../database/industry-standard-store.js';
import { trainGraphWeightsFromEvents } from '../agentic/cross-chain/graph-scorer.js';
import type { FleetChainEvent } from '../agentic/cross-chain/fleet-chain-detector.js';
import { FederatedLearningCoordinator } from '../agentic/federated/federated-learning.js';
import { EcosystemObservatory } from '../agentic/observatory/ecosystem-observatory.js';
import { ReputationNetwork } from '../agentic/reputation/reputation-network.js';
import {
  ingestCloudObservatoryRelay,
  ingestGuardianBenchIntoObservatory,
} from '../agentic/observatory/observatory-ingest.js';
import {
  publishObservatorySnapshotToMesh,
  pullObservatorySnapshotsFromMesh,
} from '../agentic/observatory/observatory-mesh-relay.js';
import { pullReputationEntriesFromMesh } from '../agentic/reputation/reputation-mesh-pull.js';
import { runGuardianBenchScorecard } from '../utils/guardian-bench.js';

function openStore(dbPath?: string): IndustryStandardStore {
  const db = new HistoryDatabase(dbPath ?? process.env.GUARDIAN_HISTORY_DB ?? ':memory:');
  return new IndustryStandardStore(db);
}

const DEFAULT_TRAIN_SAMPLES: Array<{ events: FleetChainEvent[]; label: 0 | 1 }> = [
  {
    label: 1,
    events: [
      { globalSessionId: 's', agentId: 'a', serverName: 'fs', toolName: 'read_file', eventType: 'tool_call', blocked: false, timestamp: 1, argumentsSnapshot: { path: '/etc/passwd' } },
      { globalSessionId: 's', agentId: 'a', serverName: 'wh', toolName: 'http_request', eventType: 'tool_call', blocked: false, timestamp: 2, argumentsSnapshot: { url: 'https://evil.com' } },
    ],
  },
  {
    label: 0,
    events: [
      { globalSessionId: 's2', agentId: 'a2', serverName: 'fs', toolName: 'list_dir', eventType: 'tool_call', blocked: false, timestamp: 1 },
    ],
  },
];

export function runRoadmapFleetGraphTrain(opts: { output: string; db?: string }): { w1: number[]; w2: number[] } {
  const store = openStore(opts.db);
  const alerts = store.listFleetChainAlerts(undefined, 20);
  const samples = [...DEFAULT_TRAIN_SAMPLES];
  for (const alert of alerts) {
    const events = store.listFleetChainEvents(alert.globalSessionId, 50).map(e => ({
      globalSessionId: e.globalSessionId,
      agentId: e.agentId,
      serverName: e.serverName,
      toolName: e.toolName,
      eventType: e.eventType,
      blocked: e.blocked,
      timestamp: Date.parse(e.createdAt) || Date.now(),
      argumentsSnapshot: e.edgeJson,
    }));
    if (events.length >= 2) samples.push({ events, label: 1 });
  }
  const weights = trainGraphWeightsFromEvents(samples, 12);
  writeFileSync(opts.output, JSON.stringify(weights, null, 2), 'utf-8');
  return weights;
}

export async function runRoadmapFederatedExport(opts: { output?: string; db?: string }): Promise<unknown> {
  process.env.GUARDIAN_FEDERATED_LEARNING = 'true';
  const store = openStore(opts.db);
  const fl = new FederatedLearningCoordinator(undefined, undefined, store);
  const bundle = fl.exportModelBundle();
  if (opts.output) writeFileSync(opts.output, JSON.stringify(bundle, null, 2), 'utf-8');
  return bundle;
}

export function runRoadmapFederatedImport(opts: { input: string; db?: string }): void {
  process.env.GUARDIAN_FEDERATED_LEARNING = 'true';
  const store = openStore(opts.db);
  const fl = new FederatedLearningCoordinator(undefined, undefined, store);
  const bundle = JSON.parse(readFileSync(opts.input, 'utf-8')) as { modelVersion: string; weights: number[] };
  fl.importModelBundle(bundle);
}

export async function runRoadmapObservatorySync(opts: { db?: string }): Promise<{
  cloud: { ingested: number; cloudAvailable: boolean };
  mesh: number;
  published: boolean;
}> {
  const store = openStore(opts.db);
  const obs = new EcosystemObservatory(store);
  const bench = runGuardianBenchScorecard();
  ingestGuardianBenchIntoObservatory(obs, {
    blockRate: bench.blockRate,
    falsePositiveRate: bench.falsePositiveRate,
    serverCount: Number(process.env.GUARDIAN_FLEET_SERVER_COUNT ?? 1),
  });
  const cloud = await ingestCloudObservatoryRelay(obs);
  const mesh = await pullObservatorySnapshotsFromMesh(obs);
  const pub = await publishObservatorySnapshotToMesh(obs);
  return { cloud, mesh, published: pub.ok };
}

export async function runRoadmapReputationSync(opts: { db?: string }): Promise<number> {
  const store = openStore(opts.db);
  const net = new ReputationNetwork(store);
  return pullReputationEntriesFromMesh(net);
}

export async function runRoadmapPlanComplianceAudit(): Promise<import('../agentic/plan-compliance-audit.js').PlanComplianceReport> {
  const { runPlanComplianceAudit } = await import('../agentic/plan-compliance-audit.js');
  return runPlanComplianceAudit();
}
