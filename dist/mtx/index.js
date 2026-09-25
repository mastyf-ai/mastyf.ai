/**
 * MCP Threat Exchange (MTX) v1 — keep in sync with packages/mtx/src/index.ts
 */
import { createHash } from 'crypto';
export const MTX_VERSION = '1.0';
export function hashSignature(input) {
    return createHash('sha256').update(input).digest('hex');
}
export function buildMtxRecord(params) {
    const argPatternHash = hashSignature(params.argFingerprint);
    const signatureHash = hashSignature(`${params.toolName}:${argPatternHash}:${params.category}`);
    const now = new Date().toISOString();
    return {
        mtxVersion: MTX_VERSION,
        signatureHash,
        toolPattern: params.toolName,
        argPatternHash,
        category: params.category,
        blockReason: params.blockReason.slice(0, 200),
        corpusId: params.corpusId,
        reportCount: params.reportCount ?? 1,
        firstSeen: now,
        lastSeen: now,
        deploymentSalt: params.deploymentSalt,
    };
}
export function serializeMtxRecord(record) {
    return JSON.stringify(record);
}
//# sourceMappingURL=index.js.map