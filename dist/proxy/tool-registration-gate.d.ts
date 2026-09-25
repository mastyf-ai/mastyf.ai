import type { ToolDefinition } from '@mastyf_ai/core';
export interface RegistrationGateResult {
    block: boolean;
    reason?: string;
    rule?: string;
}
export declare function isToolRegistrationGateEnabled(): boolean;
/** Queue async corpus scan when tools/list is observed. */
export declare function registerToolsFromList(serverName: string, tools: ToolDefinition[]): void;
export declare function evaluateToolRegistrationGate(serverName: string, toolName: string): RegistrationGateResult;
/** @internal */
export declare function resetToolRegistrationGateForTests(): void;
//# sourceMappingURL=tool-registration-gate.d.ts.map