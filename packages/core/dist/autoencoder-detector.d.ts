import type { Issue } from './types.js';
export interface AutoencoderFeatureVector {
    toolNameEntropy: number;
    argDepth: number;
    keyPathHash: number;
    timeSinceLastCall: number;
    argLength: number;
    suspiciousChars: number;
}
export interface AutoencoderResult {
    anomaly: boolean;
    reconstructionError: number;
    threshold: number;
    featureVector: AutoencoderFeatureVector;
}
export declare function extractAutoencoderFeatures(toolName: string, args: Record<string, unknown> | undefined, keyPath: string): AutoencoderFeatureVector;
/**
 * Train the autoencoder on a benign feature vector.
 * Returns the reconstruction error (lower = more "normal").
 */
export declare function trainOnBenign(features: AutoencoderFeatureVector): number;
/**
 * Detect anomalies in a tool call argument.
 * Returns { anomaly: true, reconstructionError: N } if error exceeds threshold.
 */
export declare function detectAnomaly(features: AutoencoderFeatureVector): AutoencoderResult;
/**
 * Integrated scan: extract features from tool call → run autoencoder → return issues if anomaly.
 */
export declare function runAutoencoderScan(toolName: string, args: Record<string, unknown> | undefined, keyPath: string): {
    issues: Issue[];
    error: number;
};
/** Get model stats for dashboard. */
export declare function getAutoencoderStats(): {
    enabled: boolean;
    trained: boolean;
    trainingSamples: number;
    threshold: number;
    modelSize: string;
};
export declare function resetForTests(): void;
//# sourceMappingURL=autoencoder-detector.d.ts.map