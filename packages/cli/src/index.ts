#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { scanServer, verifyToolDefinitions } from "@mastyf_ai/core";
import { fetchToolsFromStdio } from "@mastyf_ai/core";
import { fetchToolsFromHttp, fetchToolsFromSse } from "@mastyf_ai/core";
import type { ServerScanResult, ToolScanResult } from "@mastyf_ai/core";

interface ClaudeDesktopConfig {
  mcpServers?: Record<string, {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    transport?: string;
  }>;
}

const { values: flags, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    json: { type: "boolean", default: false },
    "fail-on-critical": { type: "boolean", default: false },
    "fail-on-warning": { type: "boolean", default: false },
    "skip-semantic": { type: "boolean", default: false },
    "skip-pinning": { type: "boolean", default: false },
    verbose: { type: "boolean", short: "v", default: false },
    url: { type: "string" },
    transport: { type: "string" },
    server: { type: "string" },
    mcp: { type: "boolean", default: false },
  },
  allowPositionals: true,
});

async function resolveConfigPath(): Promise<string> {
  if (positionals[0]) return positionals[0];
  const candidates = [
    join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    join(homedir(), ".config", "Claude", "claude_desktop_config.json"),
    join(process.env.APPDATA ?? "", "Claude", "claude_desktop_config.json"),
  ];
  return candidates.find(existsSync) ?? candidates[0];
}

function printReport(results: ServerScanResult[], verbose: boolean): void {
  for (const server of results) {
    const icon = server.status === "critical" ? "[CRIT]" :
      server.status === "warning" ? "[WARN]" : "[OK]";

    console.log(`\n${icon}  ${server.serverName} [${server.transport}]`);
    console.log(`   ${server.summary.total} tools | ${server.summary.critical} critical | ${server.summary.warnings} warnings | ${server.summary.clean} clean`);

    for (const tool of server.tools) {
      if (tool.status === "clean" && !verbose) continue;
      const toolIcon = tool.status === "critical" ? "  [CRIT]" : "  [WARN]";
      console.log(`${toolIcon} ${tool.toolName}`);
      for (const issue of tool.issues) {
        if (issue.severity === "info") continue;
        console.log(`       [${issue.id}] ${issue.message}`);
        if (verbose && issue.evidence) console.log(`       evidence: "${issue.evidence}"`);
        if (verbose && issue.confidence < 1.0) console.log(`       confidence: ${(issue.confidence * 100).toFixed(0)}%`);
      }
    }
  }
}

async function main() {
  if (flags.mcp) {
    const { startMcpServer } = await import("@mastyf_ai/mcp-server");
    await startMcpServer();
    return;
  }

  const results: ServerScanResult[] = [];

  // Single URL mode
  if (flags.url) {
    const transport = (flags.transport ?? "http") as "stdio" | "http" | "sse";
    const fetchFn = transport === "sse" ? fetchToolsFromSse : fetchToolsFromHttp;
    const tools = await fetchFn({ url: flags.url });
    const scanResult = await scanServer(flags.url, tools, transport, { skipSemantic: flags["skip-semantic"] });

    if (!flags["skip-pinning"]) {
      const pinResult = verifyToolDefinitions(tools, flags.url);
      if (pinResult.status === "changed" || pinResult.status === "tampered") {
        scanResult.status = "critical";
      }
    }
    results.push(scanResult);
  } else {
    // Claude Desktop config mode
    const configPath = await resolveConfigPath();
    if (!existsSync(configPath)) {
      console.error(`Config not found: ${configPath}`);
      process.exit(1);
    }

    const config: ClaudeDesktopConfig = JSON.parse(readFileSync(configPath, "utf8"));
    const servers = config.mcpServers ?? {};

    for (const [serverName, serverConfig] of Object.entries(servers)) {
      if (flags.server && serverName !== flags.server) continue;

      let tools;
      let transport: "stdio" | "http" | "sse" = "stdio";

      if (serverConfig.url) {
        const raw = (serverConfig.transport as string | undefined) ?? "http";
        if (raw === "sse") {
          transport = "sse";
          tools = await fetchToolsFromSse({ url: serverConfig.url });
        } else {
          transport = "http";
          tools = await fetchToolsFromHttp({ url: serverConfig.url });
        }
      } else if (serverConfig.command) {
        tools = await fetchToolsFromStdio({ command: serverConfig.command, args: serverConfig.args, env: serverConfig.env });
      } else {
        console.warn(`  Skipping ${serverName}: no command or URL`);
        continue;
      }

      const scanResult = await scanServer(serverName, tools, transport, { skipSemantic: flags["skip-semantic"] });

      if (!flags["skip-pinning"]) {
        const pinResult = verifyToolDefinitions(tools, serverName);
        if (pinResult.status === "changed") console.warn(`  Tool definitions changed in "${serverName}" since last approval`);
        if (pinResult.status === "tampered") {
          console.error(`  Manifest tampered for "${serverName}" - treat as critical`);
          scanResult.status = "critical";
        }
      }
      results.push(scanResult);
    }
  }

  if (flags.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    printReport(results, flags.verbose ?? false);
  }

  const hasCritical = results.some(r => r.status === "critical");
  const hasWarning = results.some(r => r.status === "warning");

  if (flags["fail-on-critical"] && hasCritical) process.exit(2);
  if (flags["fail-on-warning"] && (hasCritical || hasWarning)) process.exit(2);
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});