import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
export function resolveAttestationSinkPath() {
    return process.env['MASTYF_AI_AUDIT_ATTESTATION_PATH']
        || join(homedir(), '.mastyf-ai', 'attestations', 'audit-checkpoints.json');
}
export function checkpointAuditChain(entryHash) {
    const sinkPath = resolveAttestationSinkPath();
    mkdirSync(dirname(sinkPath), { recursive: true });
    const now = new Date().toISOString();
    const payload = { lastCheckpointAt: now, lastCheckpointHash: entryHash, sinkPath };
    const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    writeFileSync(sinkPath, JSON.stringify({ ...payload, payloadHash }, null, 2), 'utf-8');
    return { ok: true, ...payload };
}
export function getAuditAttestationStatus() {
    const sinkPath = resolveAttestationSinkPath();
    if (!existsSync(sinkPath)) {
        return { ok: false, sinkPath, reason: 'no attestation checkpoint found' };
    }
    try {
        const json = JSON.parse(readFileSync(sinkPath, 'utf-8'));
        return {
            ok: Boolean(json.lastCheckpointAt && json.lastCheckpointHash && json.payloadHash),
            sinkPath,
            lastCheckpointAt: json.lastCheckpointAt,
            lastCheckpointHash: json.lastCheckpointHash,
            reason: json.payloadHash ? undefined : 'checkpoint payload hash missing',
        };
    }
    catch (err) {
        return {
            ok: false,
            sinkPath,
            reason: err instanceof Error ? err.message : String(err),
        };
    }
}
//# sourceMappingURL=audit-attestation.js.map