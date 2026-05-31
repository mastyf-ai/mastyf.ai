/**
 * MCP Threat Exchange (MTX) v1 — open format for anonymized MCP attack signatures.
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

export function validateMtxRecord(raw: unknown): raw is MtxRecordV1 {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return (
    r.mtxVersion === MTX_VERSION
    && typeof r.signatureHash === 'string'
    && typeof r.toolPattern === 'string'
    && typeof r.argPatternHash === 'string'
    && typeof r.category === 'string'
    && typeof r.blockReason === 'string'
    && typeof r.reportCount === 'number'
  );
}

export function serializeMtxRecord(record: MtxRecordV1): string {
  return JSON.stringify(record);
}

export function parseMtxRecord(json: string): MtxRecordV1 | null {
  try {
    const parsed = JSON.parse(json) as unknown;
    return validateMtxRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function mergeMtxRecords(existing: MtxRecordV1, incoming: MtxRecordV1): MtxRecordV1 {
  return {
    ...existing,
    reportCount: existing.reportCount + incoming.reportCount,
    lastSeen: incoming.lastSeen,
    blockReason: incoming.blockReason || existing.blockReason,
  };
}
