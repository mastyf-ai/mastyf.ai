/**
 * Per-tool request timeouts (enterprise).
 * MASTYF_AI_TOOL_TIMEOUT_JSON='{"slow_query":120000,"read_file":10000}'
 */
const DEFAULT_MS = parseInt(process.env['MASTYF_AI_REQUEST_TIMEOUT_MS'] || '30000', 10) || 30_000;
let cache = null;
function loadMap() {
    if (cache)
        return cache;
    cache = {};
    const raw = process.env['MASTYF_AI_TOOL_TIMEOUT_JSON'];
    if (!raw)
        return cache;
    try {
        const parsed = JSON.parse(raw);
        for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === 'number' && v > 0)
                cache[k] = v;
        }
    }
    catch {
        cache = {};
    }
    return cache;
}
export function resolveToolTimeoutMs(toolName, fallbackMs = DEFAULT_MS) {
    const map = loadMap();
    return map[toolName] ?? fallbackMs;
}
//# sourceMappingURL=tool-timeout.js.map