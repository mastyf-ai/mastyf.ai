/**
 * Tamper-evident append-only audit log chaining (SHA-256).
 * Enable: MASTYF_AI_AUDIT_HASH_CHAIN=true
 */
import { createHash } from 'crypto';
import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { checkpointAuditChain } from './audit-attestation.js';
export function isAuditHashChainEnabled() {
    return process.env['MASTYF_AI_AUDIT_HASH_CHAIN'] === 'true';
}
export function isSiemAuditHashChainEnabled() {
    return isAuditHashChainEnabled() && process.env['MASTYF_AI_AUDIT_HASH_CHAIN_SIEM'] !== 'false';
}
export function resolveSiemAuditChainPath() {
    const custom = process.env['MASTYF_AI_AUDIT_HASH_CHAIN_SIEM_LOG']?.trim();
    if (custom)
        return custom;
    return join(homedir(), '.mastyf-ai', 'siem-audit-chained.jsonl');
}
/** Append a SIEM/security event to the chained JSONL trail (best-effort). */
export function appendSiemChainedEvent(type, payload) {
    if (!isSiemAuditHashChainEnabled())
        return;
    try {
        const path = resolveSiemAuditChainPath();
        mkdirSync(dirname(path), { recursive: true });
        appendChainedJsonlLine(path, {
            type,
            timestamp: new Date().toISOString(),
            ...payload,
        });
    }
    catch {
        /* best-effort — must not break hot path */
    }
}
const GENESIS = createHash('sha256').update('mastyf-ai-audit-genesis').digest('hex');
export function computeEntryHash(prevHash, payloadJson) {
    return createHash('sha256').update(`${prevHash}\n${payloadJson}`).digest('hex');
}
export class AuditHashChain {
    lastHash;
    constructor(initialHash = GENESIS) {
        this.lastHash = initialHash;
    }
    getLastHash() {
        return this.lastHash;
    }
    /** Append payload; returns line object including chain fields. */
    append(payload) {
        const record = { ...payload };
        const body = JSON.stringify(record);
        const entry_hash = computeEntryHash(this.lastHash, body);
        const line = {
            prev_hash: this.lastHash,
            entry_hash,
            record,
        };
        this.lastHash = entry_hash;
        return line;
    }
}
/** Load last entry_hash from JSONL file or genesis. */
export function loadChainTipFromJsonl(filePath) {
    if (!existsSync(filePath))
        return GENESIS;
    try {
        const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
        if (lines.length === 0)
            return GENESIS;
        const last = JSON.parse(lines[lines.length - 1]);
        return typeof last.entry_hash === 'string' ? last.entry_hash : GENESIS;
    }
    catch {
        return GENESIS;
    }
}
export function appendChainedJsonlLine(filePath, payload) {
    const tip = loadChainTipFromJsonl(filePath);
    const chain = new AuditHashChain(tip);
    const line = chain.append(payload);
    appendFileSync(filePath, `${JSON.stringify(line)}\n`, { encoding: 'utf-8' });
    if (process.env['MASTYF_AI_AUDIT_ATTESTATION_ENABLED'] === 'true') {
        try {
            checkpointAuditChain(line.entry_hash);
        }
        catch {
            // best effort, must not fail the main write path
        }
    }
    return line;
}
/** Verify an in-memory or on-disk trail; returns first invalid index or -1 if valid. */
export function verifyChainedJsonlLines(lines) {
    let expectedPrev = GENESIS;
    for (let i = 0; i < lines.length; i++) {
        const row = lines[i];
        if (row.prev_hash !== expectedPrev)
            return i;
        const payloadJson = JSON.stringify(row.record ?? {});
        const expected = computeEntryHash(expectedPrev, payloadJson);
        if (row.entry_hash !== expected)
            return i;
        expectedPrev = row.entry_hash;
    }
    return -1;
}
//# sourceMappingURL=audit-hash-chain.js.map