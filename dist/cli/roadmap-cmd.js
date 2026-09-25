/**
 * CLI: mastyf-ai roadmap — industry-standard A1–C5 utilities.
 */
import { writeFileSync, readFileSync } from 'fs';
import { HistoryDatabase } from '../database/history-db.js';
import { IndustryStandardStore } from '../database/industry-standard-store.js';
import { trainGraphWeightsFromEvents } from '../agentic/cross-chain/graph-scorer.js';
import { FederatedLearningCoordinator } from '../agentic/federated/federated-learning.js';
import { EcosystemObservatory } from '../agentic/observatory/ecosystem-observatory.js';
import { ReputationNetwork } from '../agentic/reputation/reputation-network.js';
import { ingestCloudObservatoryRelay, ingestMastyfAiBenchIntoObservatory, } from '../agentic/observatory/observatory-ingest.js';
import { publishObservatorySnapshotToMesh, pullObservatorySnapshotsFromMesh, } from '../agentic/observatory/observatory-mesh-relay.js';
import { pullReputationEntriesFromMesh } from '../agentic/reputation/reputation-mesh-pull.js';
import { runMastyfAiBenchScorecard } from '../utils/mastyf-ai-bench.js';
function openStore(dbPath) {
    const db = new HistoryDatabase(dbPath ?? process.env.MASTYF_AI_HISTORY_DB ?? ':memory:');
    return new IndustryStandardStore(db);
}
const DEFAULT_TRAIN_SAMPLES = [
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
export function runRoadmapFleetGraphTrain(opts) {
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
        if (events.length >= 2)
            samples.push({ events, label: 1 });
    }
    const weights = trainGraphWeightsFromEvents(samples, 12);
    writeFileSync(opts.output, JSON.stringify(weights, null, 2), 'utf-8');
    return weights;
}
export async function runRoadmapFederatedExport(opts) {
    process.env.MASTYF_AI_FEDERATED_LEARNING = 'true';
    const store = openStore(opts.db);
    const fl = new FederatedLearningCoordinator(undefined, undefined, store);
    const bundle = fl.exportModelBundle();
    if (opts.output)
        writeFileSync(opts.output, JSON.stringify(bundle, null, 2), 'utf-8');
    return bundle;
}
export function runRoadmapFederatedImport(opts) {
    process.env.MASTYF_AI_FEDERATED_LEARNING = 'true';
    const store = openStore(opts.db);
    const fl = new FederatedLearningCoordinator(undefined, undefined, store);
    const bundle = JSON.parse(readFileSync(opts.input, 'utf-8'));
    fl.importModelBundle(bundle);
}
export async function runRoadmapObservatorySync(opts) {
    const store = openStore(opts.db);
    const obs = new EcosystemObservatory(store);
    const bench = runMastyfAiBenchScorecard();
    ingestMastyfAiBenchIntoObservatory(obs, {
        blockRate: bench.blockRate,
        falsePositiveRate: bench.falsePositiveRate,
        serverCount: Number(process.env.MASTYF_AI_FLEET_SERVER_COUNT ?? 1),
    });
    const cloud = await ingestCloudObservatoryRelay(obs);
    const mesh = await pullObservatorySnapshotsFromMesh(obs);
    const pub = await publishObservatorySnapshotToMesh(obs);
    return { cloud, mesh, published: pub.ok };
}
export async function runRoadmapReputationSync(opts) {
    const store = openStore(opts.db);
    const net = new ReputationNetwork(store);
    return pullReputationEntriesFromMesh(net);
}
export async function runRoadmapPlanComplianceAudit() {
    const { runPlanComplianceAudit } = await import('../agentic/plan-compliance-audit.js');
    return runPlanComplianceAudit();
}
//# sourceMappingURL=roadmap-cmd.js.map