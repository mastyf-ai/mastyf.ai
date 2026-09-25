import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolveThreatStatePath } from '../ai/ai-paths.js';
import { walkStringLeaves } from './arg-leaf-walker.js';
import { getMtxThreatPatterns } from '../utils/mtx-threat-intel-bridge.js';
import { compilePolicyRegex, safeRegexTest, UnsafePolicyRegexError } from './regex-compile.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SIGNATURES_PATH = join(REPO_ROOT, 'config', 'threat-intel-signatures.json');
let cachedPatterns = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;
const MAX_THREAT_INTEL_INPUT_CHARS = 64_000;
function compilePattern(source) {
    const trimmed = source.trim();
    if (!trimmed)
        return null;
    try {
        return compilePolicyRegex(trimmed, 'i');
    }
    catch (err) {
        if (err instanceof UnsafePolicyRegexError)
            return null;
        return null;
    }
}
function loadBaselinePatterns() {
    if (!existsSync(SIGNATURES_PATH))
        return [];
    try {
        const data = JSON.parse(readFileSync(SIGNATURES_PATH, 'utf-8'));
        return (data.patterns ?? [])
            .map((p) => compilePattern(p))
            .filter((p) => p !== null);
    }
    catch {
        return [];
    }
}
function loadDynamicPatterns() {
    try {
        const path = resolveThreatStatePath();
        if (!existsSync(path))
            return [];
        const data = JSON.parse(readFileSync(path, 'utf-8'));
        const entries = data.entries ?? data.catalog ?? [];
        const patterns = [];
        for (const entry of entries) {
            if (entry.signature) {
                const compiled = compilePattern(entry.signature);
                if (compiled)
                    patterns.push(compiled);
            }
            if (entry.description && (entry.severity === 'CRITICAL' || entry.severity === 'HIGH')) {
                const snippet = entry.description.slice(0, 120).trim();
                if (snippet.length >= 24) {
                    const compiled = compilePattern(snippet);
                    if (compiled)
                        patterns.push(compiled);
                }
            }
        }
        return patterns;
    }
    catch {
        return [];
    }
}
function loadMtxHashPatterns() {
    return getMtxThreatPatterns()
        .map((hash) => compilePattern(hash.slice(0, 64)))
        .filter((p) => p !== null);
}
function getPatterns() {
    if (process.env.MASTYF_AI_DISABLE_THREAT_INTEL_GUARD === 'true')
        return [];
    const now = Date.now();
    if (cachedPatterns && now - cachedAt < CACHE_TTL_MS)
        return cachedPatterns;
    cachedPatterns = [...loadBaselinePatterns(), ...loadDynamicPatterns(), ...loadMtxHashPatterns()];
    cachedAt = now;
    return cachedPatterns;
}
/** Reset cached patterns (tests). */
export function resetThreatIntelGuardCache() {
    cachedPatterns = null;
    cachedAt = 0;
}
/** Block tool calls whose arguments match live or baseline threat-intel signatures. */
export function evaluateThreatIntelGuard(ctx) {
    const patterns = getPatterns();
    if (patterns.length === 0)
        return null;
    const blob = walkStringLeaves(ctx.arguments ?? {})
        .map((leaf) => leaf.value)
        .join('\n');
    if (!blob)
        return null;
    for (const pattern of patterns) {
        if (safeRegexTest(pattern, blob, MAX_THREAT_INTEL_INPUT_CHARS)) {
            return {
                action: 'block',
                rule: 'threat-intel',
                reason: 'Threat intel signature matched in tool arguments',
            };
        }
    }
    return null;
}
//# sourceMappingURL=threat-intel-guard.js.map