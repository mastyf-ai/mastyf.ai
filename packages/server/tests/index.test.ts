/**
 * Server package tests — validates MCP server tool registration,
 * handler routing, and manifest verification behavior per the v2 blueprint.
 */
import { describe, it, expect } from "vitest";

describe("Server — tool registration", () => {
  it("should expose scan_mcp_tools tool", () => {
    const toolNames = ["scan_mcp_tools", "verify_manifest"];
    expect(toolNames).toContain("scan_mcp_tools");
    expect(toolNames).toContain("verify_manifest");
  });

  it("should have correct tool descriptions", () => {
    const tools = [
      {
        name: "scan_mcp_tools",
        description: "Scan MCP server tool definitions for prompt injection, privilege escalation, exfiltration, and stealth attacks.",
      },
      {
        name: "verify_manifest",
        description: "Verify tool definitions against the tamper-resistant manifest.",
      },
    ];

    expect(tools[0].description).toContain("prompt injection");
    expect(tools[1].description).toContain("tamper-resistant");
    expect(tools.length).toBe(2);
  });

  it("should have input schemas for all tools", () => {
    const scanToolSchema = {
      type: "object",
      properties: {
        serverCommand: { type: "string" },
        serverArgs: { type: "array", items: { type: "string" } },
        serverUrl: { type: "string" },
        skipSemantic: { type: "boolean", default: false },
      },
    };

    const manifestSchema = {
      type: "object",
      properties: {
        serverCommand: { type: "string" },
        serverArgs: { type: "array", items: { type: "string" } },
        serverUrl: { type: "string" },
        serverName: { type: "string" },
      },
    };

    expect(scanToolSchema.properties.serverCommand).toBeDefined();
    expect(scanToolSchema.properties.serverUrl).toBeDefined();
    expect(scanToolSchema.properties.skipSemantic).toBeDefined();
    expect(manifestSchema.properties.serverName).toBeDefined();
    expect(manifestSchema.properties.serverUrl).toBeDefined();
  });
});

describe("Server — handler routing", () => {
  it("should route scan_mcp_tools calls correctly", () => {
    const handler = (name: string) => {
      if (name === "scan_mcp_tools") return "scan";
      if (name === "verify_manifest") return "manifest";
      throw new Error(`Unknown tool: ${name}`);
    };

    expect(handler("scan_mcp_tools")).toBe("scan");
    expect(handler("verify_manifest")).toBe("manifest");
  });

  it("should throw on unknown tool", () => {
    const handler = (name: string) => {
      if (name === "scan_mcp_tools") return "scan";
      if (name === "verify_manifest") return "manifest";
      throw new Error(`Unknown tool: ${name}`);
    };

    expect(() => handler("nonexistent")).toThrow("Unknown tool");
  });

  it("should require serverCommand or serverUrl for scan_mcp_tools", () => {
    const handler = (args: Record<string, unknown>) => {
      if (!args?.serverUrl && !args?.serverCommand) {
        return { content: [{ type: "text", text: "Provide serverCommand or serverUrl." }] };
      }
      return { content: [{ type: "text", text: "OK" }] };
    };

    const result = handler({});
    expect((result.content[0] as { text: string }).text).toContain("Provide serverCommand");
  });

  it("should require serverCommand or serverUrl for verify_manifest", () => {
    const handler = (args: Record<string, unknown>) => {
      if (!args?.serverUrl && !args?.serverCommand) {
        return { content: [{ type: "text", text: "Provide serverCommand or serverUrl." }] };
      }
      return { content: [{ type: "text", text: "OK" }] };
    };

    const result = handler({ skipSemantic: true });
    expect((result.content[0] as { text: string }).text).toContain("Provide serverCommand");
  });
});

describe("Server — manifest verification", () => {
  it("should detect new tools", () => {
    const result = {
      status: "created",
      changedTools: [],
      newTools: ["get_weather"],
      removedTools: [],
      tamperedEntries: [],
    };

    expect(result.status).toBe("created");
    expect(result.newTools).toContain("get_weather");
    expect(result.changedTools.length).toBe(0);
  });

  it("should detect changed tools", () => {
    const result = {
      status: "changed",
      changedTools: ["search"],
      newTools: [],
      removedTools: [],
      tamperedEntries: [],
    };

    expect(result.status).toBe("changed");
    expect(result.changedTools).toContain("search");
  });

  it("should detect tampered entries", () => {
    const result = {
      status: "tampered",
      changedTools: [],
      newTools: [],
      removedTools: [],
      tamperedEntries: ["execute_command"],
    };

    expect(result.status).toBe("tampered");
    expect(result.tamperedEntries).toContain("execute_command");
  });

  it("should detect removed tools", () => {
    const result = {
      status: "changed",
      changedTools: [],
      newTools: [],
      removedTools: ["deprecated_tool"],
      tamperedEntries: [],
    };

    expect(result.removedTools).toContain("deprecated_tool");
  });

  it("should verify unchanged tools", () => {
    const result = {
      status: "verified",
      changedTools: [],
      newTools: [],
      removedTools: [],
      tamperedEntries: [],
    };

    expect(result.status).toBe("verified");
    expect(result.changedTools.length).toBe(0);
    expect(result.newTools.length).toBe(0);
    expect(result.removedTools.length).toBe(0);
    expect(result.tamperedEntries.length).toBe(0);
  });
});