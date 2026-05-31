/**
 * Bridge MTX mesh signatures into threat-intel-guard pattern cache.
 */
import type { IndustryStandardStore } from '../database/industry-standard-store.js';

let mtxProvider: (() => string[]) | null = null;

export function setMtxPatternProvider(provider: () => string[]): void {
  mtxProvider = provider;
}

export function clearMtxPatternProvider(): void {
  mtxProvider = null;
}

export function loadMtxPatternsFromStore(store: IndustryStandardStore, tenantId = 'default'): string[] {
  return store.listMtxPatternHashes(tenantId, 2000);
}

export function getMtxThreatPatterns(): string[] {
  if (!mtxProvider) return [];
  try {
    return mtxProvider();
  } catch {
    return [];
  }
}
