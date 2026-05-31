import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolveThreatStatePath } from '../ai/ai-paths.js';
import { walkStringLeaves } from './arg-leaf-walker.js';
import type { CallContext, PolicyDecision } from './policy-types.js';
import { getMtxThreatPatterns } from '../utils/mtx-threat-intel-bridge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SIGNATURES_PATH = join(REPO_ROOT, 'config', 'threat-intel-signatures.json');

let cachedPatterns: RegExp[] | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

function escapeRegexLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compilePattern(source: string): RegExp | null {
  const trimmed = source.trim();
  if (!trimmed) return null;
  try {
    return new RegExp(trimmed, 'i');
  } catch {
    return new RegExp(escapeRegexLiteral(trimmed), 'i');
  }
}

function loadBaselinePatterns(): RegExp[] {
  if (!existsSync(SIGNATURES_PATH)) return [];
  try {
    const data = JSON.parse(readFileSync(SIGNATURES_PATH, 'utf-8')) as { patterns?: string[] };
    return (data.patterns ?? [])
      .map((p) => compilePattern(p))
      .filter((p): p is RegExp => p !== null);
  } catch {
    return [];
  }
}

function loadDynamicPatterns(): RegExp[] {
  try {
    const path = resolveThreatStatePath();
    if (!existsSync(path)) return [];
    const data = JSON.parse(readFileSync(path, 'utf-8')) as {
      entries?: Array<{ signature?: string; description?: string; severity?: string }>;
      catalog?: Array<{ signature?: string; description?: string; severity?: string }>;
    };
    const entries = data.entries ?? data.catalog ?? [];
    const patterns: RegExp[] = [];
    for (const entry of entries) {
      if (entry.signature) {
        const compiled = compilePattern(entry.signature);
        if (compiled) patterns.push(compiled);
      }
      if (entry.description && (entry.severity === 'CRITICAL' || entry.severity === 'HIGH')) {
        const snippet = entry.description.slice(0, 120).trim();
        if (snippet.length >= 24) {
          const compiled = compilePattern(snippet);
          if (compiled) patterns.push(compiled);
        }
      }
    }
    return patterns;
  } catch {
    return [];
  }
}

function loadMtxHashPatterns(): RegExp[] {
  return getMtxThreatPatterns()
    .map((hash) => compilePattern(hash.slice(0, 64)))
    .filter((p): p is RegExp => p !== null);
}

function getPatterns(): RegExp[] {
  if (process.env.GUARDIAN_DISABLE_THREAT_INTEL_GUARD === 'true') return [];
  const now = Date.now();
  if (cachedPatterns && now - cachedAt < CACHE_TTL_MS) return cachedPatterns;
  cachedPatterns = [...loadBaselinePatterns(), ...loadDynamicPatterns(), ...loadMtxHashPatterns()];
  cachedAt = now;
  return cachedPatterns;
}

/** Reset cached patterns (tests). */
export function resetThreatIntelGuardCache(): void {
  cachedPatterns = null;
  cachedAt = 0;
}

/** Block tool calls whose arguments match live or baseline threat-intel signatures. */
export function evaluateThreatIntelGuard(ctx: CallContext): PolicyDecision | null {
  const patterns = getPatterns();
  if (patterns.length === 0) return null;

  const blob = walkStringLeaves(ctx.arguments ?? {})
    .map((leaf) => leaf.value)
    .join('\n');
  if (!blob) return null;

  for (const pattern of patterns) {
    if (pattern.test(blob)) {
      return {
        action: 'block',
        rule: 'threat-intel',
        reason: 'Threat intel signature matched in tool arguments',
      };
    }
  }
  return null;
}
