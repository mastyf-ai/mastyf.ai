export type BloomFilter = {
    bitCount: number;
    hashCount: number;
    bits: Uint8Array;
    itemCount: number;
};
export declare function createBloomFilter(opts?: {
    expectedItems?: number;
    falsePositiveRate?: number;
}): BloomFilter;
export declare function bloomAdd(filter: BloomFilter, value: string): void;
export declare function bloomMaybeHas(filter: BloomFilter, value: string): boolean;
export declare function serializeBloomFilter(filter: BloomFilter): {
    bitCount: number;
    hashCount: number;
    itemCount: number;
    bits: string;
};
export declare function deserializeBloomFilter(raw: {
    bitCount: number;
    hashCount: number;
    itemCount: number;
    bits: string;
}): BloomFilter;
/** Laplace noise for differential privacy on aggregate counts (enterprise federation). */
export declare function addLaplaceNoise(count: number, epsilon?: number, sensitivity?: number): number;
//# sourceMappingURL=bloom-filter.d.ts.map