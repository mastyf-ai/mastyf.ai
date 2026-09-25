import { spawn } from "node:child_process";
export async function fetchToolsFromStdio(config) {
    const timeoutMs = config.timeoutMs ?? 30_000;
    const initWaitMs = config.initWaitMs ?? 3_000;
    const toolsListWaitMs = config.toolsListWaitMs ?? 5_000;
    const maxRetries = config.maxRetries ?? 1;
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const tools = await attemptFetch(config, { timeoutMs, initWaitMs, toolsListWaitMs });
            return tools;
        }
        catch (err) {
            lastError = err;
            if (attempt < maxRetries) {
                // Brief backoff before retry
                await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
            }
        }
    }
    throw lastError ?? new Error(`Failed to fetch tools from ${config.command} after ${maxRetries + 1} attempts`);
}
async function attemptFetch(config, timeouts) {
    const { timeoutMs, initWaitMs, toolsListWaitMs } = timeouts;
    return new Promise((resolve, reject) => {
        const child = spawn(config.command, config.args ?? [], {
            env: { ...process.env, ...(config.env ?? {}) },
            stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                child.kill();
                reject(new Error(`Stdio server timed out after ${timeoutMs}ms`));
            }
        }, timeoutMs);
        child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
        child.stderr.on("data", () => { });
        child.on("error", (err) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                reject(err);
            }
        });
        // Wait for server to be ready, then send initialize + tools/list
        child.on("spawn", async () => {
            try {
                const send = (req) => {
                    const line = JSON.stringify(req) + "\n";
                    child.stdin.write(line);
                };
                // MCP handshake
                send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
                        protocolVersion: "2024-11-05",
                        capabilities: {},
                        clientInfo: { name: "mastyf-ai", version: "2.3.4" },
                    } });
                // Give server time to initialize (configurable, was fixed 2s)
                await new Promise(r => setTimeout(r, initWaitMs));
                send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
                // Wait for response (configurable, was fixed 3s)
                await new Promise(r => setTimeout(r, toolsListWaitMs));
                child.kill();
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    // Parse NDJSON from stdout
                    const lines = stdout.split("\n").filter(Boolean);
                    const tools = [];
                    for (const line of lines) {
                        try {
                            const msg = JSON.parse(line);
                            if (msg.id === 2 && msg.result) {
                                const result = msg.result;
                                tools.push(...(result.tools ?? []));
                            }
                        }
                        catch {
                            // Skip non-JSON lines (startup messages, etc.)
                        }
                    }
                    if (tools.length === 0) {
                        reject(new Error(`No tools returned from ${config.command} — server may have failed to initialize`));
                    }
                    else {
                        resolve(tools);
                    }
                }
            }
            catch (err) {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    reject(err);
                }
            }
        });
    });
}
//# sourceMappingURL=stdio.js.map