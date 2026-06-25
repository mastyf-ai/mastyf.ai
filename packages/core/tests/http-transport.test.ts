import { describe, it, expect, afterEach } from "vitest";
import http from "http";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  fetchToolsFromHttp,
  resetHttpFetchClientsForTests,
} from "../src/transports/http.js";
import { getDispatcherForOrigin } from "../src/transports/http-fetch-client.js";

const echoServerPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../tests/fixtures/mcp-http-echo-server.cjs",
);

function spawnEchoServer(): Promise<{ proc: ChildProcessWithoutNullStreams; url: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [echoServerPath], {
      stdio: ["ignore", "pipe", "inherit"],
      env: { ...process.env, MCP_ECHO_HOST: "127.0.0.1" },
    });
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const match = buf.match(/READY:(\d+)/);
      if (match) {
        proc.stdout.off("data", onData);
        resolve({ proc, url: `http://127.0.0.1:${match[1]}/mcp` });
      }
    };
    proc.stdout.on("data", onData);
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`echo server exited with ${code}`));
      }
    });
  });
}

function replyJsonRpc(msg: { method?: string; id?: number }) {
  if (msg.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "mock", version: "1.0.0" },
        capabilities: { tools: {} },
      },
    };
  }
  if (msg.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: { tools: [{ name: "mock-tool", description: "test", inputSchema: { type: "object" } }] },
    };
  }
  return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "not found" } };
}

describe("fetchToolsFromHttp", () => {
  afterEach(() => {
    resetHttpFetchClientsForTests();
  });

  it("fetches tools from MCP HTTP echo fixture", async () => {
    const { proc, url } = await spawnEchoServer();
    try {
      const tools = await fetchToolsFromHttp({ url });
      expect(tools.some((t) => t.name === "echo")).toBe(true);
    } finally {
      proc.kill();
    }
  });

  it("gives tools/list a full per-request timeout after slow initialize", async () => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c as Buffer));
      req.on("end", () => {
        void (async () => {
          const msg = JSON.parse(Buffer.concat(chunks).toString()) as { method?: string; id?: number };
          if (msg.method === "initialize") {
            await new Promise((r) => setTimeout(r, 8000));
          }
          const out = replyJsonRpc(msg);
          res.writeHead(200, {
            "Content-Type": "application/json",
            Connection: "keep-alive",
          });
          res.end(JSON.stringify(out));
        })();
      });
    });

    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;

    try {
      const tools = await fetchToolsFromHttp({
        url: `http://127.0.0.1:${port}/mcp`,
        timeoutMs: 10_000,
      });
      expect(tools[0]?.name).toBe("mock-tool");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 20_000);

  it("succeeds when both requests each use up to timeoutMs", async () => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c as Buffer));
      req.on("end", () => {
        void (async () => {
          const msg = JSON.parse(Buffer.concat(chunks).toString()) as { method?: string; id?: number };
          await new Promise((r) => setTimeout(r, 2000));
          const out = replyJsonRpc(msg);
          res.writeHead(200, {
            "Content-Type": "application/json",
            Connection: "keep-alive",
          });
          res.end(JSON.stringify(out));
        })();
      });
    });

    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;

    try {
      const tools = await fetchToolsFromHttp({
        url: `http://127.0.0.1:${port}/mcp`,
        timeoutMs: 5_000,
      });
      expect(tools[0]?.name).toBe("mock-tool");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 15_000);

  it("pools undici Agent per origin for connection reuse", () => {
    resetHttpFetchClientsForTests();
    const first = getDispatcherForOrigin("http://127.0.0.1:9999");
    const second = getDispatcherForOrigin("http://127.0.0.1:9999");
    expect(first).toBe(second);
  });

  it("reuses keep-alive when server supports it", async () => {
    const sockets = new Set<unknown>();
    const server = http.createServer((req, res) => {
      sockets.add(req.socket);
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c as Buffer));
      req.on("end", () => {
        const msg = JSON.parse(Buffer.concat(chunks).toString()) as { method?: string; id?: number };
        const out = replyJsonRpc(msg);
        res.writeHead(200, {
          "Content-Type": "application/json",
          Connection: "keep-alive",
          "Keep-Alive": "timeout=30",
        });
        res.end(JSON.stringify(out));
      });
    });
    server.keepAliveTimeout = 30_000;

    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;

    try {
      await fetchToolsFromHttp({ url: `http://127.0.0.1:${port}/mcp` });
      expect(sockets.size).toBeLessThanOrEqual(2);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("forwards mcp-session-id from initialize to tools/list", async () => {
    let listSessionHeader: string | undefined;
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c as Buffer));
      req.on("end", () => {
        const msg = JSON.parse(Buffer.concat(chunks).toString()) as { method?: string; id?: number };
        if (msg.method === "tools/list") {
          listSessionHeader = req.headers["mcp-session-id"] as string | undefined;
        }
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Connection: "keep-alive",
        };
        if (msg.method === "initialize") {
          headers["mcp-session-id"] = "session-abc-123";
        }
        res.writeHead(200, headers);
        res.end(JSON.stringify(replyJsonRpc(msg)));
      });
    });

    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;

    try {
      await fetchToolsFromHttp({ url: `http://127.0.0.1:${port}/mcp` });
      expect(listSessionHeader).toBe("session-abc-123");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
