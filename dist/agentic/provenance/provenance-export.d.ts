import type { ConfigProvenanceEvent } from './config-provenance-chain.js';
export interface SignedProvenanceBundle {
    version: '1.0';
    merkleRoot: string;
    eventCount: number;
    exportedAt: string;
    bundleGzipBase64: string;
    bundleSha256: string;
    signature: string;
    eventsPreview: Array<Pick<ConfigProvenanceEvent, 'eventId' | 'eventType' | 'actor' | 'createdAt'>>;
}
export declare function exportSignedProvenanceBundle(events: ConfigProvenanceEvent[], merkleRoot: string): SignedProvenanceBundle;
export declare function verifySignedProvenanceBundle(bundle: SignedProvenanceBundle): boolean;
export declare function writeSignedProvenanceTarball(events: ConfigProvenanceEvent[], merkleRoot: string, outputPath: string): {
    path: string;
    bundle: SignedProvenanceBundle;
    tarballBytes: number;
};
//# sourceMappingURL=provenance-export.d.ts.map