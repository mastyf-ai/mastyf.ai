import type { Command } from 'commander';
import { type LicenseClient } from '../license/license-client.js';
import type { CallContext } from '../policy/policy-types.js';
import { walkStringLeaves } from '../policy/arg-leaf-walker.js';
import { defaultControlPlaneUrl } from '../constants/cloud-url.js';
import { deobfuscateRecursive } from '../utils/payload-normalizer.js';
import { Logger } from '../utils/logger.js';
export interface ToolResultEvent {
    tenantId?: string;
    sessionId?: string;
    serverName: string;
    toolName: string;
    result: unknown;
}
export interface ExtensionBlock {
    rule: string;
    reason: string;
}
export interface BlockEvent extends ExtensionBlock {
    tenantId?: string;
    sessionId?: string;
    serverName: string;
    toolName: string;
    arguments?: Record<string, unknown>;
}
export interface FlowCheck {
    sessionKey: string;
    toolName: string;
    args?: Record<string, unknown>;
}
export interface ToolOutput {
    sessionKey: string;
    toolName: string;
    output: unknown;
}
export interface RequestVerdict {
    block: boolean;
    /** Blocked because the classifier wasn't sure, rather than because it found an attack. */
    unsure: boolean;
    confidence: number;
    latencyMs: number;
    reasoning: string;
}
export interface RequestClassifier {
    /** Whether it should decide calls in place of the LLM. */
    enabled(): boolean;
    /** Null when no verdict could be had. */
    classify(toolName: string, args: Record<string, unknown>): Promise<RequestVerdict | null>;
}
export interface ProxyExtension {
    name: string;
    /** Before the proxy serves anything. It may refuse to let the proxy start by exiting. */
    start?(): void | Promise<void>;
    registerCommands?(program: Command): void;
    setBlockListener?(listener: ((event: BlockEvent) => void) | null): void;
    observeToolResult?(event: ToolResultEvent): void;
    observeToolList?(serverName: string, tools: readonly {
        name?: unknown;
        annotations?: unknown;
    }[]): void;
    observePublishedContent?(method: string, result: unknown): void;
    applyMeta?(context: CallContext, meta: Record<string, unknown> | undefined): void;
    checkToolCall?(context: CallContext): ExtensionBlock | null;
    checkDataFlow?(check: FlowCheck): ExtensionBlock | null;
    recordToolOutput?(output: ToolOutput): void;
    requestClassifier?: RequestClassifier;
}
/** What the proxy lends an extension. */
export interface ExtensionHost {
    logger: Pick<typeof Logger, 'debug' | 'info' | 'warn' | 'error'>;
    license: LicenseClient;
    walkStringLeaves: typeof walkStringLeaves;
    deobfuscateRecursive: typeof deobfuscateRecursive;
    defaultControlPlaneUrl: typeof defaultControlPlaneUrl;
}
/** A configured extension that can't load stops the CLI, so nobody runs without what they asked for. */
export declare function loadExtensions(program: Command, specs?: string): Promise<void>;
export declare function startExtensions(): Promise<void>;
export declare function setExtensionsForTests(list: ProxyExtension[]): void;
export declare function setExtensionBlockListener(listener: ((event: BlockEvent) => void) | null): void;
export declare function observeToolResult(event: ToolResultEvent): void;
export declare function observeToolList(serverName: string, tools: readonly {
    name?: unknown;
    annotations?: unknown;
}[]): void;
export declare function observePublishedContent(method: string, result: unknown): void;
export declare function applyExtensionMeta(context: CallContext, meta: Record<string, unknown> | undefined): void;
export declare function recordToolOutput(output: ToolOutput): void;
/** A check that throws propagates, and the proxy's own error handling treats the call as failed. */
export declare function checkToolCall(context: CallContext): ExtensionBlock | null;
export declare function checkDataFlow(check: FlowCheck): ExtensionBlock | null;
export declare function activeRequestClassifier(): RequestClassifier | null;
//# sourceMappingURL=index.d.ts.map