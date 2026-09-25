import { fetchWithTimeout, remainingMs } from "./http-fetch-client.js";
import { parseEndpointFromSse, sseProbePaths } from "./sse-endpoint.js";
function extractSessionId(headers) {
    return headers.get("mcp-session-id")
        ?? headers.get("Mcp-Session-Id")
        ?? undefined;
}
function requestTimeoutMs(perRequestMs, deadline) {
    return Math.min(perRequestMs, remainingMs(deadline));
}
export async function fetchToolsFromHttp(config) {
    const perRequestMs = config.timeoutMs ?? 10_000;
    const deadline = Date.now() + (config.totalTimeoutMs ?? perRequestMs * 2);
    const baseHeaders = {
        "Content-Type": "application/json",
        ...(config.headers ?? {}),
    };
    const initResponse = await fetchWithTimeout(config.url, {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "mastyf-ai", version: "2.3.4" },
            },
        }),
    }, requestTimeoutMs(perRequestMs, deadline), "initialize");
    if (!initResponse.ok) {
        throw new Error(`HTTP ${initResponse.status} on initialize`);
    }
    // Drain body so the keep-alive socket returns to the pool before tools/list.
    await initResponse.text();
    const sessionId = extractSessionId(initResponse.headers);
    const listHeaders = { ...baseHeaders };
    if (sessionId) {
        listHeaders["mcp-session-id"] = sessionId;
    }
    const listResponse = await fetchWithTimeout(config.url, {
        method: "POST",
        headers: listHeaders,
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list",
            params: {},
        }),
    }, requestTimeoutMs(perRequestMs, deadline), "tools/list");
    if (!listResponse.ok) {
        throw new Error(`HTTP ${listResponse.status} on tools/list`);
    }
    const data = await listResponse.json();
    return data.result?.tools ?? [];
}
async function discoverSseMessageEndpoint(config, deadline) {
    const perRequestMs = config.timeoutMs ?? 15_000;
    const base = new URL(config.url.replace(/\/$/, ""));
    const headers = {
        Accept: "text/event-stream",
        ...(config.headers ?? {}),
    };
    for (const path of sseProbePaths(base)) {
        const sseUrl = new URL(base.href);
        if (path !== "/") {
            sseUrl.pathname = path;
        }
        const response = await fetchWithTimeout(sseUrl.href, { method: "GET", headers }, requestTimeoutMs(perRequestMs, deadline), "sse endpoint");
        if (!response.ok)
            continue;
        const text = await response.text();
        const parsed = parseEndpointFromSse(text, sseUrl);
        if (parsed)
            return parsed;
    }
    throw new Error("Failed to discover SSE message endpoint (GET /sse or /)");
}
async function postSseJsonRpc(messageUrl, body, headers, timeoutMs, label) {
    const response = await fetchWithTimeout(messageUrl.href, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...headers,
        },
        body: JSON.stringify(body),
    }, timeoutMs, label);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} on ${label}`);
    }
    return await response.json();
}
export async function fetchToolsFromSse(config) {
    const perRequestMs = config.timeoutMs ?? 15_000;
    const deadline = Date.now() + (config.totalTimeoutMs ?? perRequestMs * 3);
    const baseHeaders = { ...(config.headers ?? {}) };
    const { messageUrl } = await discoverSseMessageEndpoint(config, deadline);
    await postSseJsonRpc(messageUrl, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "mastyf-ai", version: "2.3.4" },
        },
    }, baseHeaders, requestTimeoutMs(perRequestMs, deadline), "initialize");
    const listData = await postSseJsonRpc(messageUrl, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
    }, baseHeaders, requestTimeoutMs(perRequestMs, deadline), "tools/list");
    const result = listData.result;
    return result?.tools ?? [];
}
export { parseEndpointFromSse, sseProbePaths } from "./sse-endpoint.js";
export { resetHttpFetchClientsForTests } from "./http-fetch-client.js";
//# sourceMappingURL=http.js.map