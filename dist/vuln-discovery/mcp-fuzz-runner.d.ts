import type { McpServerConfig } from '../types.js';
import { type ToolDef } from './mcp-tool-fuzzer.js';
import type { VulnFinding } from './types.js';
export interface McpFuzzRunnerOptions {
    /** Cap tools fuzzed per server (default 8). */
    maxTools?: number;
    /** Cap payloads per tool after generateFuzzPayloads (default 6). */
    maxPayloadsPerTool?: number;
    /** Per tools/call timeout ms (default 8000). */
    callTimeoutMs?: number;
    /** Injected list/call for tests (skips spawn). */
    transport?: McpFuzzTransport;
    /** Mark calls as already behind Mastyf proxy (default false = direct upstream). */
    blockedByProxyDefault?: boolean;
    /**
     * Prefer HTTP JSON-RPC against server.url (fleet/proxy endpoint) instead of stdio spawn.
     * Also enabled by MASTYF_AI_VULN_FUZZ_VIA_PROXY=true.
     */
    viaProxy?: boolean;
    /** Override proxy base URL (defaults to server.url). */
    proxyBaseUrl?: string;
}
export interface McpFuzzTransport {
    listTools(): Promise<ToolDef[]>;
    callTool(name: string, args: Record<string, unknown>): Promise<{
        ok: boolean;
        crashed?: boolean;
        error?: string;
        result?: unknown;
        blockedByProxy?: boolean;
    }>;
    close?(): Promise<void> | void;
}
export interface McpFuzzRunResult {
    findings: VulnFinding[];
    toolsFuzzed: number;
    callsMade: number;
    errors: string[];
}
/**
 * HTTP/JSON-RPC transport against a Mastyf proxy or streamable MCP URL.
 * Proxy blocks surface as blockedByProxy=true.
 */
export declare function openProxyHttpFuzzTransport(baseUrl: string, opts?: {
    timeoutMs?: number;
}): Promise<McpFuzzTransport>;
/**
 * Stdio JSON-RPC session for fuzz calls.
 */
export declare function openStdioFuzzTransport(server: McpServerConfig): Promise<McpFuzzTransport>;
/**
 * Fuzz one MCP server: list tools, mutate args, call, classify findings.
 */
export declare function fuzzServerTools(server: McpServerConfig, opts?: McpFuzzRunnerOptions): Promise<McpFuzzRunResult>;
/** Fuzz all configured servers (stdio preferred; URL via proxy when viaProxy). */
export declare function fuzzMcpServers(servers: McpServerConfig[], opts?: McpFuzzRunnerOptions): Promise<McpFuzzRunResult>;
//# sourceMappingURL=mcp-fuzz-runner.d.ts.map