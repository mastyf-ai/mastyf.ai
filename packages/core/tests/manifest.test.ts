import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  verifyToolDefinitions,
  approveToolDefinitions,
  resolveManifestSecret,
  ManifestSecretError,
  resetManifestSecretForTests,
  setManifestSecretForTests,
  setManifestPathForTests,
} from "../src/manifest.js";
import type { ToolDefinition } from "../src/types.js";

const tool: ToolDefinition = {
  name: "search",
  description: "Search the web",
};

describe("manifest secret handling", () => {
  let tempDir: string;

  beforeEach(() => {
    resetManifestSecretForTests();
    tempDir = mkdtempSync(join(tmpdir(), "manifest-test-"));
    setManifestPathForTests(join(tempDir, "tool-manifest.json"));
  });

  afterEach(() => {
    resetManifestSecretForTests();
    delete process.env.MASTYF_AI_MANIFEST_SECRET;
    delete process.env.MASTYF_AI_MANIFEST_REQUIRE_SECRET;
    delete process.env.MASTYF_AI_STRICT_MODE;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("uses MASTYF_AI_MANIFEST_SECRET when set", () => {
    process.env.MASTYF_AI_MANIFEST_SECRET = "a".repeat(32);
    expect(resolveManifestSecret()).toBe("a".repeat(32));
  });

  it("rejects short MASTYF_AI_MANIFEST_SECRET", () => {
    process.env.MASTYF_AI_MANIFEST_SECRET = "too-short";
    expect(() => resolveManifestSecret()).toThrow(ManifestSecretError);
  });

  it("requires explicit secret in strict mode", () => {
    process.env.MASTYF_AI_STRICT_MODE = "true";
    expect(() => resolveManifestSecret()).toThrow(/MASTYF_AI_MANIFEST_SECRET is required/);
  });

  it("returns error status when verifying without secret in strict mode", () => {
    process.env.MASTYF_AI_STRICT_MODE = "true";
    const result = verifyToolDefinitions([tool], "test-server");
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/MASTYF_AI_MANIFEST_SECRET/);
  });

  it("detects tampered HMAC with explicit secret", () => {
    const secret = "b".repeat(32);
    setManifestSecretForTests(secret);

    approveToolDefinitions([tool], "srv");
    const result = verifyToolDefinitions([{ ...tool, description: "Changed" }], "srv");
    expect(result.status).toBe("changed");
  });

  it("flags tampered entries when HMAC does not match", () => {
    setManifestSecretForTests("c".repeat(32));
    approveToolDefinitions([tool], "srv");

    setManifestSecretForTests("d".repeat(32));
    const result = verifyToolDefinitions([tool], "srv");
    expect(result.status).toBe("tampered");
    expect(result.tamperedEntries).toContain("search");
  });
});
