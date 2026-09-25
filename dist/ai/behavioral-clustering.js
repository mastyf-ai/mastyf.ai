/**
 * Behavioral Clustering for Novel Attack Pattern Discovery.
 * Enterprise Short-Term Plan — Sub-Phase 2B.
 *
 * Uses lightweight DBSCAN-inspired density-based clustering on 5-dimensional
 * feature vectors extracted from each tool call argument:
 *   - toolName entropy (Shannon)
 *   - argDepth (recursive depth)
 *   - keyPath pattern hash
 *   - timeSinceLastCall (seconds)
 *   - blockRateLast10min (0-1)
 *
 * Unknown clusters (no label match) → flagged as novel attack patterns.
 * Cluster labels auto-assigned via LLM every 24 hours if available.
 *
 * Environment:
 *   MASTYF_AI_BEHAVIORAL_CLUSTERING_ENABLED   Master enable (default: false)
 *   MASTYF_AI_BEHAVIORAL_CLUSTER_EPS           DBSCAN epsilon (default: 0.5)
 *   MASTYF_AI_BEHAVIORAL_MIN_CLUSTER_SIZE       Min points per cluster (default: 3)
 *   MASTYF_AI_BEHAVIORAL_FEATURE_DIM           Feature vector dimensions (default: 5)
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Logger } from '../utils/logger.js';
import { StructuredLogger } from '../utils/structured-logger.js';
// ── Configuration ────────────────────────────────────────────────────
const STATE_PATH = join(homedir(), '.mastyf-ai', 'behavioral-clusters.json');
function eps() {
    return parseFloat(process.env['MASTYF_AI_BEHAVIORAL_CLUSTER_EPS'] || '0.8');
}
function minClusterSize() {
    return parseInt(process.env['MASTYF_AI_BEHAVIORAL_MIN_CLUSTER_SIZE'] || '3', 10);
}
// ── Feature Extraction ────────────────────────────────────────────────
function shannonEntropy(str) {
    const freq = {};
    for (const ch of str) {
        freq[ch] = (freq[ch] || 0) + 1;
    }
    const len = str.length;
    return -Object.values(freq).reduce((sum, count) => {
        const p = count / len;
        return sum + p * Math.log2(p);
    }, 0) / Math.log2(len || 1); // Normalize to 0-1
}
function argDepth(obj, depth = 0) {
    if (depth > 10)
        return 10;
    if (obj === null || obj === undefined)
        return depth;
    if (typeof obj !== 'object')
        return depth;
    if (Array.isArray(obj)) {
        return Math.max(...obj.map((item) => argDepth(item, depth + 1)), depth);
    }
    const values = Object.values(obj);
    return Math.max(...values.map((v) => argDepth(v, depth + 1)), depth);
}
function keyPathHash(keyPath) {
    const hash = createHash('sha256').update(keyPath).digest('hex');
    return parseInt(hash.slice(0, 8), 16) / 0xffffffff; // Normalize to 0-1
}
let lastCallTimes = {};
let blockHistory = [];
export function extractFeatureVector(toolName, args, keyPath, serverName) {
    const now = Date.now() / 1000;
    const serverKey = `${serverName}:${toolName}`;
    const lastCall = lastCallTimes[serverKey] || now;
    lastCallTimes[serverKey] = now;
    // Block rate in last 10 minutes
    const tenMinAgo = now - 600;
    const recentBlocks = blockHistory.filter((b) => b.timestamp > tenMinAgo);
    const blockRate = recentBlocks.length > 0
        ? recentBlocks.filter((b) => b.blocked).length / recentBlocks.length
        : 0;
    return {
        toolNameEntropy: shannonEntropy(toolName),
        argDepth: (argDepth(args) || 0) / 10, // Normalize to 0-1
        keyPathHash: keyPathHash(keyPath),
        timeSinceLastCall: Math.min((now - lastCall) / 3600, 1), // Cap at 1 hour
        blockRateLast10min: blockRate,
    };
}
// ── Euclidean Distance ───────────────────────────────────────────────
function euclideanDistance(a, b) {
    return Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0));
}
function vectorToArray(v) {
    return [v.toolNameEntropy, v.argDepth, v.keyPathHash, v.timeSinceLastCall, v.blockRateLast10min];
}
// ── DBSCAN Clustering ────────────────────────────────────────────────
function dbscan(points) {
    const epsVal = eps();
    const minPts = minClusterSize();
    const clusters = new Map();
    const visited = new Set();
    const noise = new Set();
    let clusterCount = 0;
    for (const point of points) {
        if (visited.has(point.id))
            continue;
        visited.add(point.id);
        const neighbors = points.filter((p) => euclideanDistance(vectorToArray(point.vector), vectorToArray(p.vector)) <= epsVal);
        if (neighbors.length < minPts) {
            noise.add(point.id);
            continue;
        }
        clusterCount++;
        const cluster = [];
        const seedSet = new Set(neighbors.map((n) => n.id));
        for (const seedId of seedSet) {
            if (noise.has(seedId)) {
                cluster.push(seedId);
                noise.delete(seedId);
                continue;
            }
            if (visited.has(seedId))
                continue;
            visited.add(seedId);
            const seedPoint = points.find((p) => p.id === seedId);
            const seedNeighbors = points.filter((p) => euclideanDistance(vectorToArray(seedPoint.vector), vectorToArray(p.vector)) <= epsVal);
            if (seedNeighbors.length >= minPts) {
                for (const n of seedNeighbors) {
                    seedSet.add(n.id);
                }
            }
            cluster.push(seedId);
        }
        clusters.set(clusterCount, cluster);
    }
    return clusters;
}
function loadState() {
    if (!existsSync(STATE_PATH)) {
        return { clusters: {}, lastUpdate: new Date().toISOString(), totalCalls: 0 };
    }
    try {
        return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
    }
    catch {
        return { clusters: {}, lastUpdate: new Date().toISOString(), totalCalls: 0 };
    }
}
function saveState(state) {
    const dir = join(STATE_PATH, '..');
    mkdirSync(dir, { recursive: true });
    state.lastUpdate = new Date().toISOString();
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}
const KNOWN_ATTACK_LABELS = new Set([
    'sql-injection', 'nosql-injection', 'shell-obfuscation', 'command-injection',
    'prompt-injection', 'context-injection', 'file-inclusion', 'ssrf',
    'deserialization', 'xss-injection', 'log-injection', 'polyglot-injection',
    'boundary-evasion', 'credential-exfil', 'http-smuggling', 'graphql-injection',
    'jwt-manipulation', 'dangerous-js', 'exfiltration',
]);
// ── Public API ───────────────────────────────────────────────────────
let callBuffer = [];
/**
 * Record a tool call for behavioral clustering.
 * Clusters are recomputed every N calls (default: 50).
 */
export function recordBehavioralCall(toolName, args, keyPath, serverName, callId) {
    if (process.env['MASTYF_AI_BEHAVIORAL_CLUSTERING_ENABLED'] !== 'true')
        return;
    const vector = extractFeatureVector(toolName, args, keyPath, serverName);
    callBuffer.push({ id: callId, vector });
    // Recompute clusters every 50 calls
    if (callBuffer.length >= 50) {
        const clusters = recomputeClusters();
        reportNovelClusters(clusters);
        callBuffer = callBuffer.slice(-100); // Keep last 100 for context
    }
}
function recomputeClusters() {
    const rawClusters = dbscan(callBuffer);
    const state = loadState();
    state.totalCalls += callBuffer.length;
    // Map raw cluster IDs to persistent labels
    for (const [rawId, pointIds] of rawClusters.entries()) {
        const clusterKey = `cluster-${rawId}`;
        const existing = state.clusters[clusterKey];
        if (!existing) {
            // New cluster — flag as novel
            const centroid = computeCentroid(pointIds);
            state.clusters[clusterKey] = {
                clusterId: rawId,
                label: `unknown-${rawId}`,
                size: pointIds.length,
                centroid,
                isNovel: true,
                firstSeen: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
            };
        }
        else {
            existing.size = pointIds.length;
            existing.lastSeen = new Date().toISOString();
        }
    }
    saveState(state);
    return rawClusters;
}
function computeCentroid(pointIds) {
    const points = pointIds
        .map((id) => callBuffer.find((p) => p.id === id))
        .filter(Boolean);
    if (points.length === 0) {
        return { toolNameEntropy: 0, argDepth: 0, keyPathHash: 0, timeSinceLastCall: 0, blockRateLast10min: 0 };
    }
    const sum = points.reduce((acc, p) => {
        acc.toolNameEntropy += p.vector.toolNameEntropy;
        acc.argDepth += p.vector.argDepth;
        acc.keyPathHash += p.vector.keyPathHash;
        acc.timeSinceLastCall += p.vector.timeSinceLastCall;
        acc.blockRateLast10min += p.vector.blockRateLast10min;
        return acc;
    }, { toolNameEntropy: 0, argDepth: 0, keyPathHash: 0, timeSinceLastCall: 0, blockRateLast10min: 0 });
    return {
        toolNameEntropy: sum.toolNameEntropy / points.length,
        argDepth: sum.argDepth / points.length,
        keyPathHash: sum.keyPathHash / points.length,
        timeSinceLastCall: sum.timeSinceLastCall / points.length,
        blockRateLast10min: sum.blockRateLast10min / points.length,
    };
}
function reportNovelClusters(clusters) {
    const state = loadState();
    for (const [rawId, pointIds] of clusters.entries()) {
        const clusterKey = `cluster-${rawId}`;
        const summary = state.clusters[clusterKey];
        if (summary?.isNovel && summary.size >= minClusterSize()) {
            StructuredLogger.info({
                event: 'novel_behavioral_cluster',
                clusterId: rawId,
                size: summary.size,
                label: summary.label,
                centroid: summary.centroid,
            });
            Logger.warn(`[behavioral] Novel cluster detected: cluster-${rawId} (${summary.size} calls) — possible new attack pattern`);
        }
    }
}
export function getClusterSummaries() {
    const state = loadState();
    return Object.values(state.clusters);
}
export function getNovelClusters() {
    return getClusterSummaries().filter((c) => c.isNovel);
}
/** Attempt to auto-label clusters via known attack pattern knowledge. */
export function autoLabelCluster(clusterId, label) {
    const state = loadState();
    const key = `cluster-${clusterId}`;
    if (state.clusters[key]) {
        state.clusters[key].label = label;
        state.clusters[key].isNovel = !KNOWN_ATTACK_LABELS.has(label);
        saveState(state);
    }
}
export function resetForTests() {
    callBuffer = [];
    lastCallTimes = {};
    blockHistory = [];
}
//# sourceMappingURL=behavioral-clustering.js.map