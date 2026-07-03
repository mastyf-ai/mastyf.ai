/**
 * B3 — Federated Learning for Threat Detection (research track, feature-flagged).
 */
import { randomUUID, createHash } from 'crypto';
import { Logger } from '../../utils/logger.js';
import {
  applyDifferentialPrivacyNoise,
  federatedPrivacyConfig,
  hashFederatedSignature,
  shouldShareFederatedDelta,
} from './federated-privacy.js';
import type { IndustryStandardStore } from '../../database/industry-standard-store.js';
import { publishFederatedDeltaViaMesh, pullFederatedDeltasFromMesh } from './federated-mesh-bridge.js';
import {
  secureAggregateWeightVectors,
  scoreWithAggregatedWeights,
  FEDERATED_WEIGHT_DIM,
} from './federated-weight-aggregation.js';
import {
  computeLocalGradient,
  fedAvgGradients,
  applyGradientToWeights,
} from './federated-gradient-aggregation.js';
import {
  maskGradientForUpload,
  sumMaskedGradients,
  unmaskAggregatedGradients,
} from './federated-masked-aggregation.js';

export interface FederatedModelDelta {
  deltaId: string;
  modelVersion: string;
  signatureHash: string;
  sampleCount: number;
  privacyBudgetEpsilon: number;
  createdAt: string;
}

export interface FederatedRolloutDecision {
  rolloutId: string;
  modelVersion: string;
  stage: 'canary' | 'partial' | 'full';
  approved: boolean;
  reason: string;
}

export interface OnnxInferenceResult {
  score: number;
  label: 'benign' | 'injection' | 'exfil';
  modelVersion: string;
  backend: 'onnxruntime' | 'aggregated-weights';
}

async function tryOnnxRuntimeScore(features: number[], modelVersion: string): Promise<OnnxInferenceResult | null> {
  if (process.env.MASTYF_AI_FEDERATED_ONNX === 'false') return null;
  try {
    const moduleName = 'onnxruntime-' + 'node';
    const ort = await (Function('return import(arguments[0])') as (name: string) => Promise<{
      InferenceSession: { create: (path: string) => Promise<{
        inputNames: string[];
        outputNames: string[];
        run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array }>>;
      }> };
      Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
    }>)(moduleName);
    const modelPath = process.env.MASTYF_AI_FEDERATED_ONNX_MODEL;
    if (!modelPath) return null;
    const session = await ort.InferenceSession.create(modelPath);
    const inputName = session.inputNames[0];
    if (!inputName) return null;
    const tensor = new ort.Tensor('float32', Float32Array.from(features), [1, features.length]);
    const out = await session.run({ [inputName]: tensor });
    const output = out[session.outputNames[0]!];
    if (!output) return null;
    const data = output.data;
    const maxIdx = data.length ? data.indexOf(Math.max(...data)) : 0;
    const labels: Array<'benign' | 'injection' | 'exfil'> = ['benign', 'injection', 'exfil'];
    const label = labels[maxIdx] ?? 'benign';
    const score = data[maxIdx] ?? 0.5;
    return { score, label, modelVersion, backend: 'onnxruntime' };
  } catch {
    return null;
  }
}

export class FederatedLearningCoordinator {
  private deltas: FederatedModelDelta[] = [];
  private activeVersion = 'baseline-v1';
  private aggregatedContributors = 0;
  private pendingRolloutApprovalId: string | null = null;
  private rolloutStage: 'baseline' | 'canary' | 'partial' | 'full' = 'baseline';
  private blockedSampleCount = 0;
  private activeWeights: number[] | null = null;
  private pendingGradients: Array<{ gradient: number[]; sampleCount: number }> = [];

  constructor(
    private readonly approvalGate?: import('../core.js').ApprovalGate,
    private readonly bandit?: import('../rl/contextual-bandit.js').ContextualBanditPolicyTuner,
    private readonly store?: IndustryStandardStore,
  ) {}

  isEnabled(): boolean {
    return process.env.MASTYF_AI_FEDERATED_LEARNING === 'true';
  }

  submitLocalDelta(params: {
    signatureHash: string;
    sampleCount: number;
    privacyBudgetEpsilon?: number;
  }): FederatedModelDelta | null {
    if (!this.isEnabled()) return null;

    const privacy = federatedPrivacyConfig();
    const gate = shouldShareFederatedDelta({
      sampleCount: params.sampleCount,
      epsilon: params.privacyBudgetEpsilon ?? privacy.epsilon,
      minReports: privacy.minReports,
    });
    if (!gate.share) {
      Logger.info(`[FederatedLearning] Delta suppressed: ${gate.reason}`);
      return null;
    }

    const noisySampleCount = Math.max(
      1,
      Math.round(applyDifferentialPrivacyNoise(params.sampleCount, gate.privacyBudgetEpsilon)),
    );
    const signatureHash = hashFederatedSignature(`${params.signatureHash}:${noisySampleCount}`);

    const delta: FederatedModelDelta = {
      deltaId: randomUUID(),
      modelVersion: this.activeVersion,
      signatureHash,
      sampleCount: noisySampleCount,
      privacyBudgetEpsilon: gate.privacyBudgetEpsilon,
      createdAt: new Date().toISOString(),
    };
    this.deltas.push(delta);
    if (this.deltas.length > 100) this.deltas.splice(0, this.deltas.length - 100);
    this.store?.saveFederatedDelta(delta);
    void publishFederatedDeltaViaMesh(delta);
    Logger.info(`[FederatedLearning] Delta submitted: ${delta.deltaId} (ε=${delta.privacyBudgetEpsilon}, n=${delta.sampleCount})`);
    return delta;
  }

  /** Record gradient contribution from blocked detection features (B3 FedAvg path). */
  recordBlockedFeatures(features: number[], sampleCount = 1): void {
    if (!this.isEnabled() || !features.length) return;
    const weights = this.getActiveWeights() ?? new Array(FEDERATED_WEIGHT_DIM).fill(0);
    const gradient = computeLocalGradient(features, 1, weights);
    this.pendingGradients.push({ gradient, sampleCount });
  }

  /** Auto-collect from blocked detections (B3 hot path feeding). */
  recordBlockedSignature(signatureHash: string, features?: number[]): FederatedModelDelta | null {
    if (!this.isEnabled()) return null;
    this.blockedSampleCount++;
    if (features?.length) this.recordBlockedFeatures(features, this.blockedSampleCount);
    return this.submitLocalDelta({
      signatureHash,
      sampleCount: this.blockedSampleCount,
    });
  }

  /** A/B traffic split for federated model routing (B3 rollout). */
  shouldRouteToFederatedModel(requestId: string): boolean {
    if (!this.isEnabled() || this.rolloutStage === 'baseline') return false;
    const bucket = parseInt(createHash('sha256').update(requestId).digest('hex').slice(0, 8), 16) % 100;
    if (this.rolloutStage === 'canary') return bucket < 10;
    if (this.rolloutStage === 'partial') return bucket < 50;
    return true;
  }

  getRolloutStage(): typeof this.rolloutStage {
    return this.rolloutStage;
  }

  /** Pull remote contributor deltas from threat mesh before aggregation (B3). */
  async syncRemoteDeltas(): Promise<number> {
    if (!this.isEnabled()) return 0;
    const remote = await pullFederatedDeltasFromMesh();
    let ingested = 0;
    for (const delta of remote) {
      const exists = this.deltas.some(d => d.deltaId === delta.deltaId);
      if (exists) continue;
      this.deltas.push(delta);
      this.store?.saveFederatedDelta(delta);
      ingested++;
    }
    if (ingested > 0) {
      Logger.info(`[FederatedLearning] Ingested ${ingested} remote delta(s) from mesh`);
    }
    return ingested;
  }

  aggregateDeltas(minContributors = 3): { aggregated: boolean; contributorCount: number; newVersion?: string; rollout?: FederatedRolloutDecision } {
    const stored = this.store?.listFederatedDeltas?.(200) ?? [];
    for (const row of stored) {
      const exists = this.deltas.some(d => d.deltaId === row.deltaId);
      if (!exists) {
        this.deltas.push({
          deltaId: row.deltaId,
          modelVersion: row.modelVersion,
          signatureHash: row.signatureHash,
          sampleCount: row.sampleCount,
          privacyBudgetEpsilon: row.privacyBudgetEpsilon,
          createdAt: row.createdAt,
        });
      }
    }

    if (!this.isEnabled() || this.deltas.length < minContributors) {
      return { aggregated: false, contributorCount: this.deltas.length };
    }

    const { weights, contributorCount } = secureAggregateWeightVectors(
      this.deltas.map(d => ({ signatureHash: d.signatureHash, sampleCount: d.sampleCount })),
    );
    const newVersion = `fl-${Date.now()}`;
    let mergedWeights = weights;
    if (this.pendingGradients.length > 0) {
      const roundId = newVersion;
      const participantIds = this.pendingGradients.map((_, i) => `local-${i}`);
      let avgGradient: number[];
      if (process.env.MASTYF_AI_FEDERATED_MPC === 'true' && participantIds.length > 1) {
        const masked = this.pendingGradients.map((g, i) =>
          maskGradientForUpload(g.gradient, participantIds[i]!, participantIds, roundId),
        );
        const summed = sumMaskedGradients(masked);
        avgGradient = unmaskAggregatedGradients(summed, participantIds, roundId);
      } else {
        avgGradient = fedAvgGradients(this.pendingGradients);
      }
      mergedWeights = applyGradientToWeights(weights, avgGradient);
      this.store?.saveFederatedGradientSnapshot?.({
        snapshotId: randomUUID(),
        modelVersion: newVersion,
        gradient: avgGradient,
        contributorCount: this.pendingGradients.length,
        createdAt: new Date().toISOString(),
      });
      this.pendingGradients = [];
    }
    this.activeWeights = mergedWeights;

    this.activeVersion = newVersion;
    this.aggregatedContributors += contributorCount;
    this.store?.saveFederatedModelWeights?.({
      modelVersion: newVersion,
      weights: mergedWeights,
      contributorCount,
      createdAt: new Date().toISOString(),
    });
    this.deltas = [];
    Logger.info(`[FederatedLearning] Secure weight aggregation complete → ${newVersion} (${contributorCount} contributors)`);

    let banditAction: import('../rl/contextual-bandit.js').PolicyAction = 'enforce';
    if (this.bandit) {
      const decision = this.bandit.selectAction({
        serverType: 'federated',
        hourOfDay: new Date().getUTCHours(),
        agentTier: 'standard',
        ruleCategory: 'prompt_injection',
      });
      banditAction = decision.action;
    }

    const needsApproval = banditAction !== 'skip';
    let approvalId: string | undefined;
    if (needsApproval && this.approvalGate) {
      approvalId = this.approvalGate.submit(
        'federated-rollout',
        `Canary rollout for federated model ${newVersion}`,
        [{
          decisionId: randomUUID(),
          source: 'federated-learning',
          rationale: `Aggregated ${minContributors}+ deltas; bandit recommends ${banditAction}`,
          confidence: 0.7,
          requiresApproval: true,
          suggestedAction: 'CANARY_ROLLOUT',
          timestamp: new Date().toISOString(),
        }],
        86_400_000,
      );
      this.pendingRolloutApprovalId = approvalId;
    }

    const rollout = this.proposeRollout(!needsApproval || Boolean(approvalId));
    if (rollout.approved) {
      this.rolloutStage = rollout.stage === 'canary' ? 'canary' : rollout.stage === 'partial' ? 'partial' : 'canary';
    }
    return { aggregated: true, contributorCount, newVersion, rollout };
  }

  approvePendingRollout(requestId: string): FederatedRolloutDecision | null {
    if (!this.approvalGate?.approve(requestId)) return null;
    const decision = this.proposeRollout(true);
    this.rolloutStage = 'canary';
    return decision;
  }

  /** Advance canary → partial → full after validation window (B3 rollout stages). */
  promoteRolloutStage(): FederatedRolloutDecision | null {
    if (!this.isEnabled() || this.rolloutStage === 'baseline') return null;
    const prev = this.rolloutStage;
    if (prev === 'canary') this.rolloutStage = 'partial';
    else if (prev === 'partial') this.rolloutStage = 'full';
    else return null;

    const decision: FederatedRolloutDecision = {
      rolloutId: randomUUID(),
      modelVersion: this.activeVersion,
      stage: this.rolloutStage,
      approved: true,
      reason: `Promoted rollout from ${prev} to ${this.rolloutStage}`,
    };
    this.store?.saveFederatedRollout?.({
      rolloutId: decision.rolloutId,
      modelVersion: decision.modelVersion,
      stage: decision.stage,
      approved: true,
      reason: decision.reason,
    });
    Logger.info(`[FederatedLearning] Rollout promoted: ${prev} → ${this.rolloutStage}`);
    return decision;
  }

  proposeRollout(approved: boolean): FederatedRolloutDecision {
    return {
      rolloutId: randomUUID(),
      modelVersion: this.activeVersion,
      stage: approved ? 'canary' : 'partial',
      approved,
      reason: approved ? 'Approval gate cleared for canary rollout' : 'Awaiting human approval',
    };
  }

  getActiveVersion(): string {
    return this.activeVersion;
  }

  getStats(): { deltaCount: number; aggregatedContributors: number; activeVersion: string } {
    return {
      deltaCount: this.deltas.length,
      aggregatedContributors: this.aggregatedContributors,
      activeVersion: this.activeVersion,
    };
  }

  getActiveWeights(): number[] | null {
    if (this.activeWeights) return this.activeWeights;
    const stored = this.store?.getLatestFederatedModelWeights?.();
    if (stored) {
      this.activeWeights = stored.weights;
      this.activeVersion = stored.modelVersion;
    }
    return this.activeWeights;
  }

  /** ONNX inference hook — tries onnxruntime-node when model path configured, else federated weight scorer */
  async runOnnxInference(features: number[]): Promise<OnnxInferenceResult | null> {
    if (!this.isEnabled()) return null;
    if (!features.length) return null;
    const salted = features.map((f, i) => f + (createHash('sha256').update(this.activeVersion).digest()[i % 32]! / 255));
    const onnx = await tryOnnxRuntimeScore(salted, this.activeVersion);
    if (onnx) return onnx;

    const weights = this.getActiveWeights();
    if (weights?.length) {
      const padded = [...salted];
      while (padded.length < FEDERATED_WEIGHT_DIM) padded.push(0);
      const score = scoreWithAggregatedWeights(padded.slice(0, FEDERATED_WEIGHT_DIM), weights);
      const label: OnnxInferenceResult['label'] = score > 0.75 ? 'injection' : score > 0.45 ? 'exfil' : 'benign';
      return { score, label, modelVersion: this.activeVersion, backend: 'aggregated-weights' };
    }
    return null;
  }

  /** Export deployable model bundle for cross-replica rollout (B3). */
  exportModelBundle(): {
    modelVersion: string;
    weights: number[];
    rolloutStage: string;
    stats: ReturnType<FederatedLearningCoordinator['getStats']>;
  } {
    return {
      modelVersion: this.activeVersion,
      weights: this.getActiveWeights() ?? [],
      rolloutStage: this.rolloutStage,
      stats: this.getStats(),
    };
  }

  /** Import aggregated weights from mesh or offline training (B3). */
  importModelBundle(bundle: { modelVersion: string; weights: number[] }): void {
    if (!bundle.weights.length) return;
    this.activeVersion = bundle.modelVersion;
    this.activeWeights = bundle.weights;
    this.store?.saveFederatedModelWeights?.({
      modelVersion: bundle.modelVersion,
      weights: bundle.weights,
      contributorCount: 1,
      createdAt: new Date().toISOString(),
    });
    Logger.info(`[FederatedLearning] Imported model bundle ${bundle.modelVersion} (${bundle.weights.length} dims)`);
  }
}
