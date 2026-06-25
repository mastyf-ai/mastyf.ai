import { describe, expect, it } from "vitest";
import { hashLlmCacheKeyForTests } from "../src/ai/llm-cache.js";

describe("semantic LLM cache keys", () => {
  const base = {
    model: "claude-test",
    system: "system prompt",
    prompt: "tool prompt",
    temperature: 0,
    policyMode: "block",
  };

  it("includes onlyOnHits and alwaysRun in the cache hash", () => {
    const thorough = hashLlmCacheKeyForTests({
      ...base,
      onlyOnHits: false,
      alwaysRun: true,
    });
    const hitsOnly = hashLlmCacheKeyForTests({
      ...base,
      onlyOnHits: true,
      alwaysRun: false,
    });
    expect(thorough).not.toBe(hitsOnly);
  });

  it("keeps stable hash for identical scan mode options", () => {
    const a = hashLlmCacheKeyForTests({ ...base, onlyOnHits: false, alwaysRun: true });
    const b = hashLlmCacheKeyForTests({ ...base, onlyOnHits: false, alwaysRun: true });
    expect(a).toBe(b);
  });
});

describe("Anthropic error redaction", () => {
  it("does not echo API keys in surfaced error messages", async () => {
    const apiKey = "sk-ant-api03-test-secret-key-value";
    const originalFetch = globalThis.fetch;
    process.env.ANTHROPIC_API_KEY = apiKey;
    process.env.MASTYF_AI_LLM_CACHE = "false";

    globalThis.fetch = (async () =>
      new Response(`Invalid API key: ${apiKey}`, { status: 401 })) as typeof fetch;

    try {
      const { runSemanticScan } = await import("../src/semantic-scanner.js");
      const issues = await runSemanticScan(
        { name: "test", description: "safe tool" },
        [],
        { apiKey, onlyOnHits: false, alwaysRun: true },
      );
      const errIssue = issues.find((i) => i.id === "MCPG-META-003");
      expect(errIssue).toBeDefined();
      expect(errIssue!.message).not.toContain(apiKey);
      expect(errIssue!.message).toContain("[REDACTED]");
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.MASTYF_AI_LLM_CACHE;
      const { resetLlmConfigForTests } = await import("../src/config/llm-config.js");
      resetLlmConfigForTests();
      const { resetCoreSemanticCircuitForTests } = await import("../src/semantic-circuit-breaker.js");
      resetCoreSemanticCircuitForTests();
    }
  });
});
