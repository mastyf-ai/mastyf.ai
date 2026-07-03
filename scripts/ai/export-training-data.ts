#!/usr/bin/env npx tsx
/**
 * Export labeled training dataset for future local model fine-tuning.
 *
 * Usage: pnpm ai:export-training-data [--out exports/training-dataset.jsonl]
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { loadSemanticAuditRecordsAsync } from '../../src/ai/semantic-audit-store.js';
import { resolveAttackLearningStatePath, resolveAiPendingSuggestionsPath } from '../../src/ai/ai-paths.js';
import { readFileSync } from 'fs';

const outArg = process.argv.find((a) => a.startsWith('--out='));
const OUT = outArg?.slice('--out='.length) || join(process.cwd(), 'exports', 'training-dataset.jsonl');

async function main(): Promise<void> {
  mkdirSync(dirname(OUT), { recursive: true });
  const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
  const tenantId = tenantArg?.slice('--tenant='.length) || process.env.MASTYF_AI_TENANT_ID || 'default';
  const lines: string[] = [];

  const semantic = await loadSemanticAuditRecordsAsync({
    tenantId: tenantId !== 'default' ? tenantId : undefined,
    sinceMs: 90 * 24 * 60 * 60 * 1000,
    limit: 5000,
  });
  for (const r of semantic) {
    if (!r.labeled || !r.label || r.label === 'ignored') continue;
    if ((r.semanticAudit?.reasoning || '').startsWith('Swarm seed from live MCP (')) continue;
    lines.push(
      JSON.stringify({
        source: 'semantic_audit',
        id: r.id,
        label: r.label,
        toolName: r.toolName,
        attackClass: r.semanticAudit?.categories?.[0],
        confidence: r.semanticAudit?.confidence,
        reasoning: r.semanticAudit?.reasoning?.slice(0, 500),
        timestamp: r.timestamp,
      }),
    );
  }

  const attackStatePath = resolveAttackLearningStatePath();
  if (existsSync(attackStatePath)) {
    try {
      const state = JSON.parse(readFileSync(attackStatePath, 'utf-8')) as {
        ruleToolCounts?: Record<string, { count: number; reasons: string[] }>;
      };
      for (const [key, stats] of Object.entries(state.ruleToolCounts || {})) {
        lines.push(
          JSON.stringify({
            source: 'block_learning',
            groupKey: key,
            blockCount: stats.count,
            reasons: stats.reasons?.slice(-5),
          }),
        );
      }
    } catch {
      /* skip */
    }
  }

  const suggestionsPath = resolveAiPendingSuggestionsPath();
  if (existsSync(suggestionsPath)) {
    try {
      const pending = JSON.parse(readFileSync(suggestionsPath, 'utf-8')) as {
        suggestions?: Array<{ id: string; ruleName: string; source: string; confidence: number }>;
      };
      for (const s of pending.suggestions || []) {
        lines.push(
          JSON.stringify({
            source: 'pending_suggestion',
            id: s.id,
            ruleName: s.ruleName,
            suggestionSource: s.source,
            confidence: s.confidence,
          }),
        );
      }
    } catch {
      /* skip */
    }
  }

  writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf-8');
  console.log(`[export-training-data] wrote ${lines.length} row(s) → ${OUT}`);

  const { buildLoraExportManifest, MIN_LORA_LABELED_ROWS } = await import(
    '../../src/ai/tenant-semantic-model.js'
  );
  const labeledRows = lines.filter((l) => {
    try {
      return JSON.parse(l).source === 'semantic_audit';
    } catch {
      return false;
    }
  }).length;
  const manifest = buildLoraExportManifest(tenantId, labeledRows);
  const manifestPath = OUT.replace(/\.jsonl$/, '.manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[export-training-data] manifest → ${manifestPath}`);
  console.log(
    `[export-training-data] Phase 3: ${labeledRows}/${MIN_LORA_LABELED_ROWS} labeled rows for LoRA`,
  );
  if (labeledRows >= MIN_LORA_LABELED_ROWS) {
    console.log(`[export-training-data] ${manifest.ollamaCreateHint}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
