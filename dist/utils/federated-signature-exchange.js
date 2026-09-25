/**
 * Federated Attack Signature Exchange — bloom-filter + noisy counts + cloud catalog pull.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { collectHeartbeatThreatSignatures, mergeThreatSignatures, } from './fleet-threat-signatures.js';
import { addLaplaceNoise, bloomAdd, bloomMaybeHas, createBloomFilter, deserializeBloomFilter, serializeBloomFilter, } from './bloom-filter.js';
import { buildFederatedShareRecords, } from './federated-threat-intel-v2.js';
export { buildSignatureHints, catalogFromFleetRows } from './federated-signature-exchange-catalog.js';
const HINTS_CACHE = join(process.cwd(), 'reports', 'fleet', 'signature-hints-cache.json');
const BLOOM_CACHE = join(process.cwd(), 'reports', 'fleet', 'signature-bloom.json');
function fleetHintsPath() {
    return HINTS_CACHE;
}
export function buildLocalSignatureBloom(signatures) {
    const filter = createBloomFilter({ expectedItems: Math.max(100, signatures.length * 2) });
    for (const s of signatures) {
        bloomAdd(filter, s.signatureId);
    }
    return filter;
}
export function loadCachedFleetHints() {
    if (!existsSync(fleetHintsPath()))
        return [];
    try {
        const raw = JSON.parse(readFileSync(fleetHintsPath(), 'utf-8'));
        return raw.hints || [];
    }
    catch {
        return [];
    }
}
export function saveCachedFleetHints(hints, bloom) {
    mkdirSync(join(process.cwd(), 'reports', 'fleet'), { recursive: true });
    writeFileSync(fleetHintsPath(), JSON.stringify({ hints, generatedAt: new Date().toISOString() }, null, 2));
    writeFileSync(BLOOM_CACHE, JSON.stringify(serializeBloomFilter(bloom), null, 2));
}
export async function fetchRemoteSignatureCatalog() {
    const base = process.env.MASTYF_AI_CONTROL_PLANE_URL?.replace(/\/$/, '');
    const apiKey = process.env.MASTYF_AI_CLOUD_API_KEY?.trim() || process.env.CONTROL_PLANE_API_KEY?.trim();
    if (!base || !apiKey)
        return null;
    try {
        const res = await fetch(`${base}/api/v1/fleet/signature-hints?window=168`, {
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok)
            return null;
        const body = (await res.json());
        return {
            signatures: (body.hints || []).map((h) => ({
                signatureId: h.signatureId,
                rule: h.rule,
                tool: h.tool,
                category: h.category,
                argShapeHash: '',
                instanceCount: h.instanceCount,
                eventCount: h.totalCount,
                lastSeen: h.lastSeen,
            })),
        };
    }
    catch {
        return null;
    }
}
export async function syncFleetSignatureHintsFromCloud() {
    const catalog = await fetchRemoteSignatureCatalog();
    if (!catalog)
        return 0;
    const local = await collectHeartbeatThreatSignatures();
    const localIds = new Set(local.map((s) => s.signatureId));
    const { buildSignatureHints } = await import('./federated-signature-exchange-catalog.js');
    const hints = buildSignatureHints(catalog, localIds).map((h) => ({
        ...h,
        totalCount: addLaplaceNoise(h.totalCount, parseFloat(process.env.MASTYF_AI_FEDERATION_EPSILON || '1.0')),
    }));
    const bloom = buildLocalSignatureBloom(local);
    saveCachedFleetHints(hints, bloom);
    return hints.length;
}
export async function buildLocalSignatureExchange(remoteCatalog) {
    const optIn = process.env.MASTYF_AI_FEDERATED_LEARNING === 'true';
    const epsilon = parseFloat(process.env.MASTYF_AI_FEDERATION_EPSILON || '1.0');
    const localSignatures = optIn ? await collectHeartbeatThreatSignatures() : [];
    const localIds = new Set(localSignatures.map((s) => s.signatureId));
    const bloom = buildLocalSignatureBloom(localSignatures);
    let catalog = remoteCatalog;
    if (!catalog && optIn) {
        catalog = (await fetchRemoteSignatureCatalog()) || undefined;
    }
    const { buildSignatureHints } = await import('./federated-signature-exchange-catalog.js');
    const cloudHints = catalog ? buildSignatureHints(catalog, localIds) : [];
    const cachedHints = loadCachedFleetHints();
    const merged = [...cloudHints];
    for (const h of cachedHints) {
        if (!merged.find((x) => x.signatureId === h.signatureId))
            merged.push(h);
    }
    const hints = merged
        .map((h) => ({
        ...h,
        totalCount: addLaplaceNoise(h.totalCount, epsilon),
        instanceCount: addLaplaceNoise(h.instanceCount, epsilon),
    }))
        .sort((a, b) => b.totalCount - a.totalCount)
        .slice(0, 50);
    return {
        localSignatures,
        hints,
        optIn,
        generatedAt: new Date().toISOString(),
        bloom: serializeBloomFilter(bloom),
        privacyEpsilon: epsilon,
    };
}
export function isSignatureKnownLocally(signatureId) {
    if (!existsSync(BLOOM_CACHE))
        return false;
    try {
        const raw = JSON.parse(readFileSync(BLOOM_CACHE, 'utf-8'));
        const bloom = deserializeBloomFilter(raw);
        return bloomMaybeHas(bloom, signatureId);
    }
    catch {
        return false;
    }
}
export function aggregateLocalWithFleet(local, fleet) {
    return mergeThreatSignatures(local, fleet);
}
export function buildWeightedFleetHints(signatures, provenanceById, ctx) {
    return buildFederatedShareRecords(signatures, provenanceById, ctx);
}
//# sourceMappingURL=federated-signature-exchange.js.map