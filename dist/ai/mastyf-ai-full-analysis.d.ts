/**
 * Unified full Mastyf AI analysis — measured facts + optional Ollama plain-English narrative.
 */
import type { IDatabase } from '../database/database-interface.js';
import { type McpHealthVerdict } from './mcp-health-report.js';
export type FullAnalysisVerdict = McpHealthVerdict;
export type FullAnalysisCitation = {
    id: string;
    source: string;
    text: string;
};
export type MastyfAiFullAnalysis = {
    generatedAt: string;
    windowDays: number;
    verdict: FullAnalysisVerdict;
    plainEnglishSummary: string;
    markdown: string;
    sections: {
        protection: string[];
        traffic: string[];
        security: string[];
        learning: string[];
        nextSteps: string[];
    };
    citations: FullAnalysisCitation[];
    source: 'measured' | 'llm';
    provider?: string;
    model?: string;
    narrative?: string;
    costCoverage?: {
        pricedCalls: number;
        unpricedCalls: number;
        coveragePct: number;
        disclaimer: string;
        measuredUsd?: number;
    };
};
export declare function buildMastyfAiFullAnalysis(db: IDatabase | null, tenantId: string | undefined, opts?: {
    windowDays?: number;
    useLlm?: boolean;
    historyDbAttached?: boolean;
}): Promise<MastyfAiFullAnalysis | null>;
//# sourceMappingURL=mastyf-ai-full-analysis.d.ts.map