import { getLlmConfig } from './config/llm-config.js';
const DEFAULT_SCAN_TOOL_TIMEOUT_MAX_MS = 15_000;
export function getScanToolTimeoutMaxMs() {
    const n = parseInt(process.env.MASTYF_AI_SCAN_TOOL_TIMEOUT_MAX_MS || '', 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_SCAN_TOOL_TIMEOUT_MAX_MS;
}
/** Per-tool scan timeout with explicit env override capped by MASTYF_AI_SCAN_TOOL_TIMEOUT_MAX_MS. */
export function resolveScanToolTimeoutMs() {
    const explicit = parseInt(process.env.MASTYF_AI_SCAN_TOOL_TIMEOUT_MS || '', 10);
    const base = Number.isFinite(explicit) && explicit > 0
        ? explicit
        : getLlmConfig().timeoutMs + 5000;
    return Math.min(base, getScanToolTimeoutMaxMs());
}
//# sourceMappingURL=scan-timeouts.js.map