#!/usr/bin/env tsx
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanTool } from "../packages/core/src/engine.js";
import type { ToolDefinition } from "../packages/core/src/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface CorpusEntry {
  id: string;
  label: string;
  expectedStatus: "clean" | "warning" | "critical";
  expectedLayer?: string[];
  expectedCategory?: string[];
  notes?: string;
  tool: ToolDefinition;
}

async function runEval() {
  const poisonedDir = join(__dirname, "poisoned");
  const benignDir = join(__dirname, "benign");

  const loadDir = (dir: string): CorpusEntry[] =>
    readdirSync(dir)
      .filter(f => f.endsWith(".json"))
      .map(f => JSON.parse(readFileSync(join(dir, f), "utf8")) as CorpusEntry);

  const poisoned = loadDir(poisonedDir);
  const benign = loadDir(benignDir);

  let tp = 0, fp = 0, tn = 0, fn = 0;
  const failures: string[] = [];

  console.log("Running corpus evaluation...\n");

  // Warn if semantic scanning is disabled and semantic tests exist
  const semanticEnabled = !!process.env.ANTHROPIC_API_KEY;
  const semanticTests = poisoned.filter(e => e.expectedLayer?.includes("semantic"));
  if (!semanticEnabled && semanticTests.length > 0) {
    console.warn(`⚠️  WARNING: ANTHROPIC_API_KEY not set - semantic scanning disabled`);
    console.warn(`   ${semanticTests.length} semantic test(s) will likely produce false negatives:`);
    for (const t of semanticTests) console.warn(`   - ${t.id}: ${t.label}`);
  }

  for (const entry of poisoned) {
    const result = await scanTool(entry.tool, {
      skipSemantic: !process.env.ANTHROPIC_API_KEY,
    });

    const detected = result.status !== "clean";
    const severityMatches = entry.expectedStatus ? result.status === entry.expectedStatus : true;

    if (detected && severityMatches) {
      // Validate layer if specified
      if (entry.expectedLayer && result.issues.length > 0) {
        const detectedLayers = result.issues.map((i: any) => i.layer);
        const hasExpectedLayer = entry.expectedLayer.some((layer: string) =>
          detectedLayers.includes(layer)
        );
        if (!hasExpectedLayer) {
          fn++;
          failures.push(`  WRONG LAYER [${entry.id}] expected: ${entry.expectedLayer.join(", ")}, got: ${detectedLayers.join(", ")}`);
          process.stdout.write(`  [${entry.id}] WRONG LAYER\n`);
          continue;
        }
      }
      tp++;
      process.stdout.write(`  [${entry.id}] ${entry.label}\n`);
    } else if (detected && !severityMatches) {
      fn++;
      failures.push(`  WRONG SEVERITY [${entry.id}] ${entry.label}  expected: ${entry.expectedStatus}, got: ${result.status}`);
      process.stdout.write(`  [${entry.id}] WRONG SEVERITY\n`);
    } else {
      fn++;
      failures.push(`  MISSED [${entry.id}] ${entry.label}  ${entry.notes ?? ""}`);
      process.stdout.write(`  [${entry.id}] MISSED\n`);
    }
  }

  for (const entry of benign) {
    const result = await scanTool(entry.tool, {
      skipSemantic: !process.env.ANTHROPIC_API_KEY,
    });

    const falseFlagged = result.status !== "clean";
    if (!falseFlagged) {
      tn++;
      process.stdout.write(`  [${entry.id}] ${entry.label} (clean)\n`);
    } else {
      fp++;
      failures.push(`  FALSE POS [${entry.id}] ${entry.label}  flagged: ${result.issues.map(i => i.id).join(", ")}`);
      process.stdout.write(`  [${entry.id}] FALSE POSITIVE\n`);
    }
  }

  const precision = tp / (tp + fp) || 0;
  const recall = tp / (tp + fn) || 0;
  const f1 = 2 * (precision * recall) / (precision + recall) || 0;

  console.log(`
CORPUS EVALUATION RESULTS
Poisoned: ${poisoned.length} cases | Benign: ${benign.length} cases
TP: ${tp}  FP: ${fp}  TN: ${tn}  FN: ${fn}

Precision: ${(precision * 100).toFixed(1)}%
Recall:    ${(recall * 100).toFixed(1)}%
F1 Score:  ${(f1 * 100).toFixed(1)}%
`);

  if (failures.length > 0) {
    console.log("FAILURES:\n" + failures.join("\n"));
  }

  if (f1 < 0.85) {
    console.error("\nF1 score below 0.85 threshold  failing build");
    process.exit(1);
  }

  console.log("\nCorpus evaluation passed");
}

runEval().catch(err => {
  console.error(err);
  process.exit(1);
});