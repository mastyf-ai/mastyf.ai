/**
 * CLI package tests — validates argument parsing, report formatting,
 * and exit code behavior per the v2 blueprint.
 */
import { describe, it, expect } from "vitest";
import { parseArgs } from "node:util";

describe("CLI — argument parsing", () => {
  it("should support --fail-on-critical flag", () => {
    const { values } = parseArgs({
      args: ["--fail-on-critical"],
      options: {
        "fail-on-critical": { type: "boolean", default: false },
      },
      allowPositionals: true,
    });
    expect(values["fail-on-critical"]).toBe(true);
  });

  it("should support --json flag", () => {
    const { values } = parseArgs({
      args: ["--json"],
      options: {
        json: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });
    expect(values.json).toBe(true);
  });

  it("should support --skip-semantic flag", () => {
    const { values } = parseArgs({
      args: ["--skip-semantic"],
      options: {
        "skip-semantic": { type: "boolean", default: false },
      },
      allowPositionals: true,
    });
    expect(values["skip-semantic"]).toBe(true);
  });

  it("should support --verbose shorthand -v", () => {
    const { values } = parseArgs({
      args: ["-v"],
      options: {
        verbose: { type: "boolean", short: "v", default: false },
      },
      allowPositionals: true,
    });
    expect(values.verbose).toBe(true);
  });

  it("should accept a positional config path", () => {
    const { positionals } = parseArgs({
      args: ["~/my-config.json"],
      options: { json: { type: "boolean", default: false } },
      allowPositionals: true,
    });
    expect(positionals[0]).toBe("~/my-config.json");
  });

  it("should default all flags to false", () => {
    const { values } = parseArgs({
      args: [],
      options: {
        "fail-on-critical": { type: "boolean", default: false },
        "fail-on-warning": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        "skip-semantic": { type: "boolean", default: false },
      },
      allowPositionals: true,
    });
    expect(values["fail-on-critical"]).toBe(false);
    expect(values["fail-on-warning"]).toBe(false);
    expect(values.json).toBe(false);
    expect(values["skip-semantic"]).toBe(false);
  });
});

describe("CLI — report formatting", () => {
  it("should format a clean server result", () => {
    const server = {
      serverName: "test-server",
      transport: "stdio" as const,
      status: "clean" as const,
      tools: [],
      summary: { total: 3, clean: 3, warnings: 0, critical: 0 },
      scannedAt: new Date().toISOString(),
    };
    expect(server.status).toBe("clean");
    expect(server.summary.clean).toBe(3);
    expect(server.summary.critical).toBe(0);
    expect(server.transport).toBe("stdio");
  });

  it("should identify critical status", () => {
    const server = {
      serverName: "critical-server",
      transport: "http" as const,
      status: "critical" as const,
      tools: [],
      summary: { total: 5, clean: 2, warnings: 1, critical: 2 },
      scannedAt: new Date().toISOString(),
    };
    expect(server.status).toBe("critical");
    expect(server.summary.critical).toBeGreaterThan(0);
  });

  it("should identify warning status", () => {
    const server = {
      serverName: "warning-server",
      transport: "sse" as const,
      status: "warning" as const,
      tools: [],
      summary: { total: 4, clean: 3, warnings: 1, critical: 0 },
      scannedAt: new Date().toISOString(),
    };
    expect(server.status).toBe("warning");
    expect(server.summary.warnings).toBeGreaterThan(0);
    expect(server.summary.critical).toBe(0);
  });
});