import { type InjectionFinding } from './prompt-injection-detector.js';
export interface ToolDefinitionLike {
    name: string;
    description?: string;
    inputSchema?: unknown;
}
/** Flatten tool metadata into pseudo-arguments for the request-path rule set. */
export declare function toolDefinitionToScanArgs(tool: ToolDefinitionLike): Record<string, unknown>;
/** Scan tool definition text (description + schema leaves) for injection / exfil patterns. */
export declare function scanToolDefinition(tool: ToolDefinitionLike): InjectionFinding[];
export declare function toolDefinitionIsMalicious(tool: ToolDefinitionLike): boolean;
//# sourceMappingURL=tool-definition-scanner.d.ts.map