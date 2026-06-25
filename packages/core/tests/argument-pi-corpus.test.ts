import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runArgumentScan } from "../src/argument-scanner.js";

const corpusDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../corpus/attacks/prompt-injection",
);

function loadCorpusFixtures(): Array<{ id: string; toolName: string; arguments: Record<string, unknown> }> {
  return readdirSync(corpusDir)
    .filter((f) => f.startsWith("pi-") && f.endsWith(".json"))
    .sort()
    .map((file) => {
      const raw = JSON.parse(readFileSync(join(corpusDir, file), "utf8")) as {
        toolName: string;
        arguments: Record<string, unknown>;
      };
      return { id: file.replace(".json", ""), toolName: raw.toolName, arguments: raw.arguments };
    });
}

describe("argument PI corpus recall", () => {
  const fixtures = loadCorpusFixtures();

  it("loads 32 prompt-injection corpus fixtures", () => {
    expect(fixtures).toHaveLength(32);
  });

  it.each(fixtures)("$id is detected by runArgumentScan", ({ toolName, arguments: args }) => {
    const { issues } = runArgumentScan(args, toolName);
    const hit = issues.some(
      (i) => i.category === "prompt-injection" || i.id.startsWith("MCPG-A-PI"),
    );
    expect(hit).toBe(true);
  });
});
