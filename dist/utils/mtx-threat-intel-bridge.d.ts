/**
 * Bridge MTX mesh signatures into threat-intel-guard pattern cache.
 */
import type { IndustryStandardStore } from '../database/industry-standard-store.js';
export declare function setMtxPatternProvider(provider: () => string[]): void;
export declare function clearMtxPatternProvider(): void;
export declare function loadMtxPatternsFromStore(store: IndustryStandardStore, tenantId?: string): string[];
export declare function getMtxThreatPatterns(): string[];
//# sourceMappingURL=mtx-threat-intel-bridge.d.ts.map