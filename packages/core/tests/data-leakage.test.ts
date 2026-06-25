import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sanitizeLlmErrorBody } from "../src/semantic-scanner.js";
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
import { hashLlmCacheKeyForTests } from "../src/ai/llm-cache.js";
import {
  appendLearnedRule,
  resetLearnedRulesForTests,
  setLearnedRulesPathForTests,
} from "../src/learned-rules-store.js";
import { validateLearnedRule } from "../src/validate-learned-rule.js";

const tool: ToolDefinition = { name: "search", description: "Search the web" };

describe("data leakage — LLM error sanitization", () => {
  it("redacts explicit secret values passed to sanitizer", () => {
    const secret = "super-secret-api-key-xyz12345";
    const out = sanitizeLlmErrorBody(`Auth failed: ${secret}`, [secret]);
    expect(out).not.toContain(secret);
    expect(out).toContain("[REDACTED]");
  });

  it("redacts sk-ant- API key patterns", () => {
    const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz";
    const out = sanitizeLlmErrorBody(`Invalid key ${key}`, []);
    expect(out).not.toContain(key);
    expect(out).toContain("[REDACTED]");
  });

  it("redacts Bearer tokens", () => {
    const token = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload";
    const out = sanitizeLlmErrorBody(`Unauthorized: ${token}`, []);
    expect(out).not.toContain("eyJhbGci");
    expect(out).toContain("Bearer [REDACTED]");
  });

  it("truncates long error bodies", () => {
    const blob = "x".repeat(1000);
    expect(sanitizeLlmErrorBody(blob, []).length).toBeLessThanOrEqual(512);
  });
});

describe("data leakage — manifest HMAC secret", () => {
  const productionSecret = "prod-manifest-secret-" + "x".repeat(16);
  let tempDir: string;
  let manifestFile: string;

  beforeEach(() => {
    resetManifestSecretForTests();
    tempDir = mkdtempSync(join(tmpdir(), "data-leak-manifest-"));
    manifestFile = join(tempDir, "tool-manifest.json");
    setManifestPathForTests(manifestFile);
    process.env.MASTYF_AI_MANIFEST_SECRET = productionSecret;
  });

  afterEach(() => {
    resetManifestSecretForTests();
    delete process.env.MASTYF_AI_MANIFEST_SECRET;
    delete process.env.MASTYF_AI_STRICT_MODE;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("does not write HMAC secret into manifest JSON", () => {
    setManifestSecretForTests(productionSecret);
    approveToolDefinitions([tool], "srv");
    const raw = readFileSync(manifestFile, "utf8");
    expect(raw).not.toContain(productionSecret);
    expect(raw).toMatch(/"hmac": "[a-f0-9]{64}"/);
  });

  it("does not echo manifest secret in strict-mode verify errors", () => {
    delete process.env.MASTYF_AI_MANIFEST_SECRET;
    process.env.MASTYF_AI_STRICT_MODE = "true";
    const result = verifyToolDefinitions([tool], "srv");
    expect(result.status).toBe("error");
    expect(result.error ?? "").not.toMatch(/prod-manifest-secret/);
    expect(JSON.stringify(result)).not.toContain(productionSecret);
  });

  it("does not echo rejected short secret in error message", () => {
    const shortSecret = "leaked-short-key";
    process.env.MASTYF_AI_MANIFEST_SECRET = shortSecret;
    let message = "";
    try {
      resolveManifestSecret();
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).not.toContain(shortSecret);
    expect(message).toMatch(/at least 32 characters/);
  });

  it("does not expose secret when approve throws in strict mode", () => {
    delete process.env.MASTYF_AI_MANIFEST_SECRET;
    process.env.MASTYF_AI_STRICT_MODE = "true";
    let message = "";
    try {
      approveToolDefinitions([tool], "srv");
    } catch (err) {
      message = err instanceof ManifestSecretError ? err.message : String(err);
    }
    expect(message).not.toContain(productionSecret);
    expect(message).toMatch(/MASTYF_AI_MANIFEST_SECRET is required/);
  });
});

describe("data leakage — LLM cache keys", () => {
  it("does not embed prompt secrets in cache key hash output", () => {
    const secretInPrompt = "sk-ant-api03-cache-leak-test-value-xyz";
    const hash = hashLlmCacheKeyForTests({
      model: "claude-test",
      system: "system",
      prompt: `tool with embedded ${secretInPrompt}`,
      temperature: 0,
      onlyOnHits: false,
      alwaysRun: true,
    });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(secretInPrompt);
    expect(hash).not.toContain("sk-ant");
  });
});

describe("data leakage — learned rules overlay", () => {
  let tempDir: string;
  let overlayPath: string;

  beforeEach(() => {
    resetLearnedRulesForTests();
    tempDir = mkdtempSync(join(tmpdir(), "data-leak-learned-"));
    overlayPath = join(tempDir, "learned-rules.json");
    setLearnedRulesPathForTests(overlayPath);
    process.env.MASTYF_AI_LEARNED_RULES_ENABLED = "true";
  });

  afterEach(() => {
    resetLearnedRulesForTests();
    delete process.env.MASTYF_AI_LEARNED_RULES_ENABLED;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("validation errors do not echo rejected regex payloads with embedded secrets", () => {
    const embeddedSecret = "sk-ant-api03-learned-rule-leak-test";
    const result = validateLearnedRule({
      target: "argument",
      regex: `(?i)ignore.*${embeddedSecret}`,
      probe: "ignore test probe",
      message: "Learned injection test",
      category: "prompt-injection",
    });
    expect(result.ok).toBe(false);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(embeddedSecret);
  });

  it("persisted overlay JSON stores only rule metadata, not env secrets", () => {
    const envSecret = "overlay-env-secret-" + "z".repeat(20);
    process.env.MASTYF_AI_TEST_LEAK_MARKER = envSecret;
    try {
      appendLearnedRule({
        target: "argument",
        regex: String.raw`ignore\s+all\s+prior\s+directives`,
        category: "prompt-injection",
        severity: "critical",
        weight: 0.9,
        message: "Learned: ignore prior directives",
        probe: "ignore all prior directives now",
        provenance: {
          attackClass: "test",
          hypothesis: "test hypothesis",
          confidence: 0.95,
          fingerprint: "fp-test",
          source: "test",
          promotedAt: new Date().toISOString(),
        },
      });
      const raw = readFileSync(overlayPath, "utf8");
      expect(raw).not.toContain(envSecret);
    } finally {
      delete process.env.MASTYF_AI_TEST_LEAK_MARKER;
    }
  });
});
