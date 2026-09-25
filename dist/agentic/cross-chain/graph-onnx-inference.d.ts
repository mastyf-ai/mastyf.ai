/**
 * A1 — Optional ONNX inference for fleet graph features.
 */
import type { FleetChainEvent } from './fleet-chain-detector.js';
export interface GraphOnnxResult {
    score: number;
    backend: 'onnxruntime' | 'unavailable';
    modelVersion: string;
}
/** Run ONNX graph classifier on fleet chain events (A1 deployment path). */
export declare function scoreGraphEventsWithOnnx(events: FleetChainEvent[]): Promise<GraphOnnxResult | null>;
//# sourceMappingURL=graph-onnx-inference.d.ts.map