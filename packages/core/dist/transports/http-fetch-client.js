import { fetch as undiciFetch, Agent } from "undici";
const agents = new Map();
export function getDispatcherForOrigin(origin) {
    let agent = agents.get(origin);
    if (!agent) {
        agent = new Agent({
            keepAliveTimeout: 30_000,
            keepAliveMaxTimeout: 60_000,
            connections: 4,
        });
        agents.set(origin, agent);
    }
    return agent;
}
export function remainingMs(deadline) {
    return Math.max(0, deadline - Date.now());
}
export async function fetchWithTimeout(url, init, timeoutMs, label) {
    if (timeoutMs <= 0) {
        throw new Error(`${label} timed out after 0ms`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const origin = new URL(url).origin;
    try {
        return await undiciFetch(url, {
            ...init,
            signal: controller.signal,
            dispatcher: getDispatcherForOrigin(origin),
        });
    }
    catch (err) {
        if (err.name === "AbortError") {
            throw new Error(`${label} timed out after ${timeoutMs}ms`);
        }
        throw err;
    }
    finally {
        clearTimeout(timer);
    }
}
/** @internal */
export function resetHttpFetchClientsForTests() {
    for (const agent of agents.values()) {
        agent.close();
    }
    agents.clear();
}
//# sourceMappingURL=http-fetch-client.js.map