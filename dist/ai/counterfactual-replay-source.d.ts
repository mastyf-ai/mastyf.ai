/**
 * Resolve replay arguments for counterfactual simulation from stored audits + corpus.
 */
import type { StoredSemanticAudit } from './semantic-audit-store.js';
export type ReplaySample = {
    id: string;
    serverName: string;
    toolName: string;
    arguments: Record<string, unknown>;
    source: 'stored_args' | 'corpus_match' | 'empty';
};
export declare function resolveReplaySample(rec: StoredSemanticAudit): ReplaySample;
export declare function summarizeReplaySources(samples: ReplaySample[]): {
    storedArgs: number;
    corpusMatch: number;
    empty: number;
};
//# sourceMappingURL=counterfactual-replay-source.d.ts.map