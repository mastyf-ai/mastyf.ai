import type { SemanticAuditResult } from './async-semantic-audit.js';
export declare function isSyncSemanticResponseEnabled(tenantId?: string): boolean;
export declare function isSyncSemanticLlmEnabled(tenantId?: string): boolean;
export interface SyncSemanticResponseInput {
    serverName: string;
    toolName: string;
    responseText: string;
    requestId?: string | number;
    tenantId?: string;
}
export interface SyncSemanticResponseResult {
    block: boolean;
    result: SemanticAuditResult;
    source: 'local' | 'llm' | 'none';
}
export declare function evaluateSyncSemanticResponse(input: SyncSemanticResponseInput): Promise<SyncSemanticResponseResult>;
//# sourceMappingURL=sync-semantic-response.d.ts.map