/**
 * Lifecycle assurance gates — rug-pull drift, CVE, registration corpus (Defense Fabric phase 3).
 */
import type { IDatabase } from '../database/database-interface.js';
import type { ToolFingerprintState } from './tool-fingerprint.js';
import type { ToolDefinition } from '@mastyf_ai/core';
export interface LifecycleGateResult {
    block: boolean;
    phase?: 'rug-pull' | 'cve' | 'registration';
    rule?: string;
    reason?: string;
    code?: number;
}
export declare function runLifecycleAssuranceGates(input: {
    serverName: string;
    toolName: string;
    tenantId: string;
    rugPullState?: ToolFingerprintState;
    db?: IDatabase;
}): Promise<LifecycleGateResult>;
export declare function onToolsListObserved(serverName: string, tools: ToolDefinition[]): void;
//# sourceMappingURL=lifecycle-assurance-gates.d.ts.map