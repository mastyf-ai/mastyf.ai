import type { ToolDefinition } from "../types.js";
import { fetchWithTimeout, remainingMs } from "./http-fetch-client.js";

export interface HttpServerConfig {
  url: string;
  headers?: Record<string, string>;
  /** Per JSON-RPC request timeout (default 10_000). Each request gets the full budget. */
  timeoutMs?: number;
  /** Optional wall-clock cap for the full initialize + tools/list handshake. */
  totalTimeoutMs?: number;
}

function extractSessionId(headers: Headers): string | undefined {
  return headers.get("mcp-session-id")
    ?? headers.get("Mcp-Session-Id")
    ?? undefined;
}

function requestTimeoutMs(
  perRequestMs: number,
  deadline: number,
): number {
  return Math.min(perRequestMs, remainingMs(deadline));
}

export async function fetchToolsFromHttp(
  config: HttpServerConfig,
): Promise<ToolDefinition[]> {
  const perRequestMs = config.timeoutMs ?? 10_000;
  const deadline = Date.now() + (config.totalTimeoutMs ?? perRequestMs * 2);
  const baseHeaders = {
    "Content-Type": "application/json",
    ...(config.headers ?? {}),
  };

  const initResponse = await fetchWithTimeout(
    config.url,
    {
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
    },
    requestTimeoutMs(perRequestMs, deadline),
    "initialize",
  );

  if (!initResponse.ok) {
    throw new Error(`HTTP ${initResponse.status} on initialize`);
  }

  // Drain body so the keep-alive socket returns to the pool before tools/list.
  await initResponse.text();

  const sessionId = extractSessionId(initResponse.headers);
  const listHeaders: Record<string, string> = { ...baseHeaders };
  if (sessionId) {
    listHeaders["mcp-session-id"] = sessionId;
  }

  const listResponse = await fetchWithTimeout(
    config.url,
    {
      method: "POST",
      headers: listHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    },
    requestTimeoutMs(perRequestMs, deadline),
    "tools/list",
  );

  if (!listResponse.ok) {
    throw new Error(`HTTP ${listResponse.status} on tools/list`);
  }

  const data = await listResponse.json() as {
    result?: { tools?: ToolDefinition[] };
  };

  return data.result?.tools ?? [];
}

export async function fetchToolsFromSse(
  config: HttpServerConfig,
): Promise<ToolDefinition[]> {
  const timeoutMs = config.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return new Promise(async (resolve, reject) => {
    try {
      const response = await fetch(config.url, {
        headers: {
          Accept: "text/event-stream",
          ...(config.headers ?? {}),
        },
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`SSE connection failed: HTTP ${response.status}`);
      }

      const tools: ToolDefinition[] = [];
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const msg = JSON.parse(line.slice(6));
              if (msg?.result?.tools) {
                tools.push(...msg.result.tools);
                clearTimeout(timeout);
                resolve(tools);
                return;
              }
            } catch {
              /* skip */
            }
          }
        }
      }

      clearTimeout(timeout);
      resolve(tools);
    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });
}

export { resetHttpFetchClientsForTests } from "./http-fetch-client.js";
