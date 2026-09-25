/**
 * Simple Bloom filter for privacy-preserving federated signature membership tests.
 */
import { createHash } from 'crypto';
function hashIndex(data, seed, bitCount) {
    const h = createHash('sha256').update(`${seed}\0${data}`).digest();
    const n = h.readUInt32BE(0) ^ h.readUInt32BE(4);
    return Math.abs(n) % bitCount;
}
export function createBloomFilter(opts) {
    const n = opts?.expectedItems ?? 1000;
    const p = opts?.falsePositiveRate ?? 0.01;
    const bitCount = Math.max(64, Math.ceil((-n * Math.log(p)) / (Math.log(2) ** 2)));
    const hashCount = Math.max(1, Math.ceil((bitCount / n) * Math.log(2)));
    return {
        bitCount,
        hashCount,
        bits: new Uint8Array(Math.ceil(bitCount / 8)),
        itemCount: 0,
    };
}
export function bloomAdd(filter, value) {
    for (let i = 0; i < filter.hashCount; i++) {
        const idx = hashIndex(value, i, filter.bitCount);
        filter.bits[idx >> 3] |= 1 << (idx & 7);
    }
    filter.itemCount += 1;
}
export function bloomMaybeHas(filter, value) {
    for (let i = 0; i < filter.hashCount; i++) {
        const idx = hashIndex(value, i, filter.bitCount);
        if ((filter.bits[idx >> 3] & (1 << (idx & 7))) === 0)
            return false;
    }
    return true;
}
export function serializeBloomFilter(filter) {
    return {
        bitCount: filter.bitCount,
        hashCount: filter.hashCount,
        itemCount: filter.itemCount,
        bits: Buffer.from(filter.bits).toString('base64'),
    };
}
export function deserializeBloomFilter(raw) {
    return {
        bitCount: raw.bitCount,
        hashCount: raw.hashCount,
        itemCount: raw.itemCount,
        bits: new Uint8Array(Buffer.from(raw.bits, 'base64')),
    };
}
/** Laplace noise for differential privacy on aggregate counts (enterprise federation). */
export function addLaplaceNoise(count, epsilon = 1.0, sensitivity = 1) {
    const scale = sensitivity / epsilon;
    const u = Math.random() - 0.5;
    const noise = -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
    return Math.max(0, Math.round(count + noise));
}
//# sourceMappingURL=bloom-filter.js.map