/**
 * MCP Threat Exchange (MTX) v1 — keep in sync with packages/mtx/src/index.ts
 */
import { createHash } from 'crypto';

export const MTX_VERSION = '1.0' as const;

export interface MtxRecordV1 {
  mtxVersion: typeof MTX_VERSION;
  signatureHash: string;
  toolPattern: string;
  argPatternHash: string;
  category: string;
  blockReason: string;
  corpusId?: string;
  reportCount: number;
  firstSeen: string;
  lastSeen: string;
  deploymentSalt?: string;
}

export function hashSignature(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function buildMtxRecord(params: {
  toolName: string;
  argFingerprint: string;
  category: string;
  blockReason: string;
  corpusId?: string;
  reportCount?: number;
  deploymentSalt?: string;
}): MtxRecordV1 {
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

export function serializeMtxRecord(record: MtxRecordV1): string {
  return JSON.stringify(record);
}
