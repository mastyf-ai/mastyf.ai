export interface EntropyFinding {
    kind: 'high-entropy' | 'base64-blob' | 'dns-exfil';
    preview: string;
    entropy: number;
}
export declare function scanArgumentEntropy(text: string): EntropyFinding[];
export declare function isProxyEntropyCheckEnabled(policyMode?: string): boolean;
//# sourceMappingURL=arg-entropy.d.ts.map