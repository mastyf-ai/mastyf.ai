/**
 * Canonical threat classification for auto corpus + Threat Lab.
 */
import type { ThreatLabDiscovery } from './threat-lab.js';
export declare const CORPUS_CATEGORIES: readonly ["prompt-injection", "shell-obfuscation", "credential-exfil", "ssrf-url", "sql-nosql", "cross-tool-chain", "threat-intel"];
export type CorpusCategory = (typeof CORPUS_CATEGORIES)[number];
export declare function normalizeAttackClassSlug(raw: string): string;
export declare function categoryFromBlockRule(rule: string): CorpusCategory;
export declare function categoryFromSemanticCategories(categories: string[] | undefined): CorpusCategory;
export declare function categoryFromAttackClass(attackClass: string): CorpusCategory;
export declare function attackClassFromBlockRule(rule: string): string;
export declare function normalizeDiscoveryClassification(discovery: ThreatLabDiscovery): ThreatLabDiscovery;
//# sourceMappingURL=threat-taxonomy.d.ts.map