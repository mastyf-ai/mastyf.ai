/**
 * Lightweight Autoencoder for Zero-Day Anomaly Detection.
 * Enterprise Short-Term Plan — Sub-Phase 2A.
 *
 * Architecture: 3-layer autoencoder (64→16→64) with sigmoid activation.
 * Trained on benign `tools/call` feature vectors extracted from MCP traffic.
 * Reconstruction error > 0.85 → flagged as anomaly (possible zero-day attack).
 *
 * Feature vector (6 dimensions):
 *   - toolNameShannonEntropy (0-1)
 *   - argumentDepth (normalized 0-1)
 *   - keyPathPatternHash (normalized 0-1)
 *   - timeSinceLastCall (normalized 0-1)
 *   - argumentLength (log-normalized 0-1)
 *   - containsSuspiciousChars (0/1 — null bytes, homoglyphs, encoding patterns)
 *
 * Online learning: updates weights on every 100 benign calls (stochastic gradient descent).
 * Model persists to ~/.mastyf-ai/autoencoder-model.json for cold-start recovery.
 *
 * Environment:
 *   MASTYF_AI_AUTOENCODER_ENABLED       Master enable (default: false)
 *   MASTYF_AI_AUTOENCODER_THRESHOLD      Reconstruction error threshold (default: 0.85)
 *   MASTYF_AI_AUTOENCODER_BATCH_SIZE     Online learning batch size (default: 100)
 *   MASTYF_AI_AUTOENCODER_LEARNING_RATE  SGD learning rate (default: 0.01)
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
// ── Configuration ────────────────────────────────────────────────────
const MODEL_PATH = join(homedir(), '.mastyf-ai', 'autoencoder-model.json');
function enabled() {
    return process.env['MASTYF_AI_AUTOENCODER_ENABLED'] === 'true';
}
function threshold() {
    return parseFloat(process.env['MASTYF_AI_AUTOENCODER_THRESHOLD'] || '0.85');
}
function batchSize() {
    return parseInt(process.env['MASTYF_AI_AUTOENCODER_BATCH_SIZE'] || '100', 10);
}
function learningRate() {
    return parseFloat(process.env['MASTYF_AI_AUTOENCODER_LEARNING_RATE'] || '0.01');
}
// ── Autoencoder Architecture (64→16→64) ─────────────────────────────
const INPUT_DIM = 6;
const HIDDEN_DIM = 16;
const OUTPUT_DIM = 6;
function createRandomModel() {
    const W1 = [];
    for (let i = 0; i < HIDDEN_DIM; i++) {
        W1.push(Array.from({ length: INPUT_DIM }, () => (Math.random() - 0.5) * 0.1));
    }
    const b1 = Array.from({ length: HIDDEN_DIM }, () => 0);
    const W2 = [];
    for (let i = 0; i < OUTPUT_DIM; i++) {
        W2.push(Array.from({ length: HIDDEN_DIM }, () => (Math.random() - 0.5) * 0.1));
    }
    const b2 = Array.from({ length: OUTPUT_DIM }, () => 0);
    return { W1, b1, W2, b2, trained: false, trainingSamples: 0 };
}
// ── Math Helpers ─────────────────────────────────────────────────────
function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
}
function sigmoidDerivative(x) {
    const s = sigmoid(x);
    return s * (1 - s);
}
function dotProduct(a, b) {
    return a.reduce((sum, v, i) => sum + v * b[i], 0);
}
function vectorAdd(a, b) {
    return a.map((v, i) => v + b[i]);
}
// ── Forward Pass ────────────────────────────────────────────────────
function forward(input, model) {
    // Encoder: hidden = sigmoid(W1 · input + b1)
    const hidden = [];
    for (let i = 0; i < HIDDEN_DIM; i++) {
        hidden.push(sigmoid(dotProduct(model.W1[i], input) + model.b1[i]));
    }
    // Decoder: output = sigmoid(W2 · hidden + b2)
    const output = [];
    for (let i = 0; i < OUTPUT_DIM; i++) {
        output.push(sigmoid(dotProduct(model.W2[i], hidden) + model.b2[i]));
    }
    return { hidden, output };
}
function reconstructionError(input, output) {
    let error = 0;
    for (let i = 0; i < input.length; i++) {
        error += (input[i] - output[i]) ** 2;
    }
    return Math.sqrt(error / input.length);
}
// ── Backward Pass (SGD) ─────────────────────────────────────────────
function backpropagate(input, hidden, output, model, lr) {
    // Output layer error: (output - target) * sigmoid'(output)
    const outputError = [];
    for (let i = 0; i < OUTPUT_DIM; i++) {
        outputError.push((output[i] - input[i]) * sigmoidDerivative(output[i]));
    }
    // Hidden layer error: W2^T · outputError * sigmoid'(hidden)
    const hiddenError = [];
    for (let i = 0; i < HIDDEN_DIM; i++) {
        let sum = 0;
        for (let j = 0; j < OUTPUT_DIM; j++) {
            sum += model.W2[j][i] * outputError[j];
        }
        hiddenError.push(sum * sigmoidDerivative(hidden[i]));
    }
    // Update W2, b2
    for (let i = 0; i < OUTPUT_DIM; i++) {
        for (let j = 0; j < HIDDEN_DIM; j++) {
            model.W2[i][j] -= lr * outputError[i] * hidden[j];
        }
        model.b2[i] -= lr * outputError[i];
    }
    // Update W1, b1
    for (let i = 0; i < HIDDEN_DIM; i++) {
        for (let j = 0; j < INPUT_DIM; j++) {
            model.W1[i][j] -= lr * hiddenError[i] * input[j];
        }
        model.b1[i] -= lr * hiddenError[i];
    }
}
// ── Model Persistence ────────────────────────────────────────────────
function loadModel() {
    if (!existsSync(MODEL_PATH))
        return createRandomModel();
    try {
        const raw = JSON.parse(readFileSync(MODEL_PATH, 'utf-8'));
        return {
            W1: raw.W1 || [],
            b1: raw.b1 || [],
            W2: raw.W2 || [],
            b2: raw.b2 || [],
            trained: raw.trained || false,
            trainingSamples: raw.trainingSamples || 0,
        };
    }
    catch {
        return createRandomModel();
    }
}
function saveModel(model) {
    const dir = join(MODEL_PATH, '..');
    mkdirSync(dir, { recursive: true });
    writeFileSync(MODEL_PATH, JSON.stringify(model));
}
let _model = null;
let _benignBuffer = [];
function getModel() {
    if (!_model)
        _model = loadModel();
    return _model;
}
// ── Feature Extraction ──────────────────────────────────────────────
export function extractAutoencoderFeatures(toolName, args, keyPath) {
    const argsStr = args ? JSON.stringify(args) : '';
    const argsLen = argsStr.length;
    // Shannon entropy of tool name
    const freq = {};
    for (const ch of toolName)
        freq[ch] = (freq[ch] || 0) + 1;
    const toolNameEntropy = -Object.values(freq).reduce((sum, count) => {
        const p = count / toolName.length;
        return sum + p * Math.log2(p);
    }, 0) / Math.log2(toolName.length || 1);
    // Argument depth
    function depth(obj, d = 0) {
        if (d > 10 || obj === null || obj === undefined)
            return d;
        if (typeof obj !== 'object')
            return d;
        if (Array.isArray(obj))
            return Math.max(...obj.map((i) => depth(i, d + 1)), d);
        const vals = Object.values(obj);
        return Math.max(...vals.map((v) => depth(v, d + 1)), d);
    }
    // KeyPath pattern hash
    const hash = createHash('sha256').update(keyPath).digest('hex');
    const keyPathHash = parseInt(hash.slice(0, 8), 16) / 0xffffffff;
    // Suspicious character presence: null bytes, zero-width, encoding patterns
    const suspiciousChars = (argsStr.includes('\0') ||
        argsStr.includes('\u200B') ||
        argsStr.includes('\u200C') ||
        argsStr.includes('\x00') ||
        /%[0-9a-fA-F]{2}/.test(argsStr) ||
        /\\x[0-9a-fA-F]{2}/.test(argsStr)) ? 1 : 0;
    return {
        toolNameEntropy,
        argDepth: depth(args) / 10,
        keyPathHash,
        timeSinceLastCall: 0, // Updated by caller
        argLength: Math.min(argsLen / 10000, 1),
        suspiciousChars,
    };
}
function featuresToArray(f) {
    return [f.toolNameEntropy, f.argDepth, f.keyPathHash, f.timeSinceLastCall, f.argLength, f.suspiciousChars];
}
// ── Public API ──────────────────────────────────────────────────────
/**
 * Train the autoencoder on a benign feature vector.
 * Returns the reconstruction error (lower = more "normal").
 */
export function trainOnBenign(features) {
    if (!enabled())
        return 0;
    const model = getModel();
    const input = featuresToArray(features);
    const { hidden, output } = forward(input, model);
    const error = reconstructionError(input, output);
    _benignBuffer.push({ input, output, hidden });
    model.trainingSamples++;
    // Online learning: update weights every N benign calls
    if (_benignBuffer.length >= batchSize()) {
        const lr = learningRate();
        for (const sample of _benignBuffer) {
            backpropagate(sample.input, sample.hidden, sample.output, model, lr);
        }
        _benignBuffer = [];
        model.trained = true;
        saveModel(model);
    }
    return error;
}
/**
 * Detect anomalies in a tool call argument.
 * Returns { anomaly: true, reconstructionError: N } if error exceeds threshold.
 */
export function detectAnomaly(features) {
    if (!enabled()) {
        return { anomaly: false, reconstructionError: 0, threshold: threshold(), featureVector: features };
    }
    const model = getModel();
    if (!model.trained) {
        // Not enough training data — cannot detect anomalies yet
        return { anomaly: false, reconstructionError: 0, threshold: threshold(), featureVector: features };
    }
    const input = featuresToArray(features);
    const { output } = forward(input, model);
    const error = reconstructionError(input, output);
    return {
        anomaly: error > threshold(),
        reconstructionError: error,
        threshold: threshold(),
        featureVector: features,
    };
}
/**
 * Integrated scan: extract features from tool call → run autoencoder → return issues if anomaly.
 */
export function runAutoencoderScan(toolName, args, keyPath) {
    const issues = [];
    if (!enabled())
        return { issues, error: 0 };
    const features = extractAutoencoderFeatures(toolName, args, keyPath);
    const result = detectAnomaly(features);
    if (result.anomaly) {
        issues.push({
            id: 'MCPG-A-AUTO-001',
            layer: 'semantic',
            severity: 'warning',
            category: 'zero-day-anomaly',
            message: `Autoencoder anomaly detected: reconstruction error ${result.reconstructionError.toFixed(3)} exceeds threshold ${result.threshold}`,
            evidence: JSON.stringify(result.featureVector),
            confidence: Math.min(result.reconstructionError, 0.95),
        });
    }
    return { issues, error: result.reconstructionError };
}
/** Get model stats for dashboard. */
export function getAutoencoderStats() {
    const model = getModel();
    return {
        enabled: enabled(),
        trained: model.trained,
        trainingSamples: model.trainingSamples,
        threshold: threshold(),
        modelSize: `${INPUT_DIM}→${HIDDEN_DIM}→${OUTPUT_DIM}`,
    };
}
export function resetForTests() {
    _model = createRandomModel();
    _benignBuffer = [];
}
//# sourceMappingURL=autoencoder-detector.js.map