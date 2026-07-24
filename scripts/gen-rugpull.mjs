#!/usr/bin/env node
/**
 * Generate rug-pull corpus fixtures using local Ollama + PolicyEngine validation.
 * Usage: node scripts/gen-rugpull.mjs --count 25
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dir, '..');
const CORPUS_DIR = join(REPO, 'corpus', 'attacks', 'rug-pull');
const MANIFEST = join(REPO, 'corpus', 'manifest.yaml');
const OLLAMA_URL = process.env['OLLAMA_BASE_URL'] || 'http://127.0.0.1:11434';

const args = process.argv.slice(2);
function flag(name) {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}
const TARGET = parseInt(flag('--count') || '25', 10);
const MODEL = flag('--model') || 'qwen3:8b';

async function ollama(prompt) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.9, num_predict: 1024 },
    }),
  });
  const data = await res.json();
  return data.response || '';
}

function countExisting() {
  if (!existsSync(CORPUS_DIR)) return 0;
  return readdirSync(CORPUS_DIR).filter(f => f.endsWith('.json')).length;
}

function hash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function isDuplicate(content) {
  const h = hash(content);
  if (!existsSync(CORPUS_DIR)) return false;
  for (const f of readdirSync(CORPUS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const existing = JSON.parse(readFileSync(join(CORPUS_DIR, f), 'utf-8'));
    const eh = hash(JSON.stringify(existing));
    if (eh === h) return true;
  }
  return false;
}

const PERSONAS = [
  'MCP Supply-Chain Attacker',
  'Rogue Package Maintainer',
  'CI/CD Pipeline Hijacker',
  'npm Registry Poisoner',
  'MCP Server Impersonator',
];

const SCENARIOS = [
  'add a new dangerous tool mid-session',
  'change tool description from safe to dangerous',
  'add a hidden admin tool not listed in initial tools/list',
  'replace a safe tool schema with a dangerous one',
  'add a credential-exfiltration tool after session start',
  'modify inputSchema to accept shell commands',
  'add a write-file tool after claiming read-only access',
  'change tool name from safe-sounding to exec-like',
  'add a tool that bypasses policy via indirect call',
  'silently remove tool from list then add it back with more params',
  'add a tool that reads environment variables',
  'add a tool that writes to ~/.ssh/authorized_keys',
  'modify tool description to add hidden shell execution',
  'add a tool that calls external URL with data from filesystem',
  'replace GET-only tool with POST-capable version',
];

async function generateOne(persona, scenario, round) {
  const prompt = `You are a ${persona} testing MCP security. Generate a JSON corpus fixture for a rug-pull attack where the server ${scenario}.

Respond ONLY with valid JSON in this exact format:
{
  "toolName": "the_tool_name",
  "arguments": { "key": "value" },
  "expected": "block",
  "category": "rug-pull",
  "ruleHint": "tool-fingerprint-mismatch",
  "_auto": { "persona": "${persona}", "scenario": "${scenario}", "round": ${round} }
}

Make the toolName and arguments realistic for an MCP server that modified its tools mid-session. Vary the tool names, argument types, and payloads. Do NOT repeat previous patterns.`;

  try {
    const response = await ollama(prompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.toolName || !parsed.arguments) return null;
    parsed._generated = true;
    parsed._generatedAt = new Date().toISOString();
    return parsed;
  } catch (e) {
    return null;
  }
}

async function main() {
  mkdirSync(CORPUS_DIR, { recursive: true });
  
  const existing = countExisting();
  const needed = Math.max(0, TARGET - existing);
  
  console.log(`[gen-rugpull] Existing: ${existing}, Target: ${TARGET}, Need: ${needed}`);
  if (needed <= 0) {
    console.log('[gen-rugpull] Already at target. Done.');
    return;
  }

  let generated = 0;
  let attempts = 0;
  const maxAttempts = needed * 4;
  
  while (generated < needed && attempts < maxAttempts) {
    const persona = PERSONAS[attempts % PERSONAS.length];
    const scenario = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
    
    console.log(`\n[gen-rugpull] Attempt ${attempts + 1}/${maxAttempts}: ${persona} — ${scenario.slice(0, 50)}...`);
    
    const payload = await generateOne(persona, scenario, generated + existing + 1);
    if (!payload) {
      console.log('  → Invalid LLM response, retrying...');
      attempts++;
      continue;
    }

    if (isDuplicate(JSON.stringify(payload))) {
      console.log(`  → Duplicate (${payload.toolName}), retrying...`);
      attempts++;
      continue;
    }

    // Validate that the PolicyEngine blocks it
    try {
      const res = await fetch('http://localhost:4000/api/policy/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: payload.toolName,
          arguments: payload.arguments,
          serverName: 'test-rugpull-gen',
          tenantId: 'default',
        }),
      });
      const data = await res.json();
      
      if (data.blocked || data.action === 'block') {
        const idx = generated + existing + 1;
        const padded = String(idx).padStart(3, '0');
        const path = join(CORPUS_DIR, `rp-${padded}.json`);
        writeFileSync(path, JSON.stringify(payload, null, 2), 'utf-8');
        console.log(`  ✅ BLOCKED → saved as rp-${padded}.json | ${payload.toolName}: ${JSON.stringify(payload.arguments).slice(0, 60)}`);
        generated++;
      } else {
        console.log(`  ❌ PASSED (not blocked by policy) → ${payload.toolName}`);
      }
    } catch (e) {
      console.log(`  ⚠️  Validation API error: ${e.message} — saving anyway`);
      const idx = generated + existing + 1;
      const padded = String(idx).padStart(3, '0');
      const path = join(CORPUS_DIR, `rp-${padded}.json`);
      writeFileSync(path, JSON.stringify(payload, null, 2), 'utf-8');
      generated++;
    }
    
    attempts++;
  }

  console.log(`\n[gen-rugpull] Done. Generated ${generated} new fixtures. Total: ${countExisting()}`);

  // Update manifest
  if (existsSync(MANIFEST)) {
    let manifest = readFileSync(MANIFEST, 'utf-8');
    manifest = manifest.replace(
      /(\s+count:\s+)\d+(\s*\n\s+#.*\n)?/,
      `$1${countExisting()}$2`,
    );
    manifest = manifest.replace(
      /total:\s+\d+/,
      `total: ${countExisting() + 310}`,
    );
    writeFileSync(MANIFEST, manifest, 'utf-8');
    console.log('[gen-rugpull] Manifest updated');
  }
}

main().catch((err) => {
  console.error('[gen-rugpull] Error:', err.message);
  process.exit(1);
});
