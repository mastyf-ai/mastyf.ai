/**
 * A1 — Graph-based causal confidence scoring (heuristic + lightweight graph neural layer).
 */
import type { FleetChainEvent } from './fleet-chain-detector.js';
/** Boost chain confidence when argument snapshots show causal read→encode→exfil flow. */
export declare function scoreCausalGraphConfidence(events: FleetChainEvent[], baseConfidence: number): number;
/** Export normalized feature matrix for optional offline GNN training (A1). */
export declare function exportGraphFeatures(events: FleetChainEvent[]): number[][];
export declare function computeGraphNeuralScore(events: FleetChainEvent[], baseConfidence: number): number;
/** Supervised weight tuning from labeled fleet chain events (A1 training export). */
export declare function trainGraphWeightsFromEvents(samples: Array<{
    events: FleetChainEvent[];
    label: 0 | 1;
}>, epochs?: number, learningRate?: number): {
    w1: number[];
    w2: number[];
};
//# sourceMappingURL=graph-scorer.d.ts.map