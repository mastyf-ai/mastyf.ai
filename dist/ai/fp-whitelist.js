/**
 * False-positive whitelist — after N human confirmations, skip matching rule+pattern blocks.
 */
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { Logger } from '../utils/logger.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import { getQuorumConfig, resolveLabelUserId } from './learning-quorum.js';
const DEFAULT_THRESHOLD = parseInt(process.env.MASTYF_AI_FP_WHITELIST_THRESHOLD || '3', 10);
const COORDINATED_WINDOW_MS = 60 * 60 * 1000;
const COORDINATED_MIN_COUNT = 5;
function resolveWhitelistPath() {
    if (process.env.MASTYF_AI_FP_WHITELIST_PATH) {
        return process.env.MASTYF_AI_FP_WHITELIST_PATH;
    }
    return join(homedir(), '.mastyf-ai', '.fp-whitelist.json');
}
export function fpFingerprint(rule, pattern) {
    return createHash('sha256').update(`${rule}\0${pattern}`).digest('hex').slice(0, 16);
}
function loadFile() {
    const path = resolveWhitelistPath();
    if (!existsSync(path)) {
        return { version: 1, entries: [] };
    }
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf-8'));
        if (parsed.version === 1 && Array.isArray(parsed.entries))
            return parsed;
    }
    catch {
        Logger.warn('[fp-whitelist] Corrupt whitelist file — resetting');
    }
    return { version: 1, entries: [] };
}
function saveFile(data) {
    const path = resolveWhitelistPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}
/** Pending confirmations with userId + timestamp (anti-coordinated poisoning). */
const pendingConfirmations = new Map();
function isCoordinatedSingleUserAttack(confirmations) {
    if (confirmations.length < COORDINATED_MIN_COUNT)
        return false;
    const now = Date.now();
    const recent = confirmations.filter((c) => now - new Date(c.ts).getTime() <= COORDINATED_WINDOW_MS);
    if (recent.length < COORDINATED_MIN_COUNT)
        return false;
    const distinct = new Set(recent.map((c) => c.userId));
    return distinct.size === 1;
}
function hasFpQuorum(confirmations) {
    const cfg = getQuorumConfig();
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const recent = confirmations.filter((c) => now - new Date(c.ts).getTime() <= hourAgo);
    const distinct = new Set(recent.map((c) => c.userId)).size;
    return distinct >= cfg.minDistinctLabelers || recent.length >= cfg.minTotalLabels;
}
/**
 * Record a false-positive rejection from TUI/dashboard.
 * After threshold confirmations from distinct labelers, persists whitelist entry.
 */
export function recordFpRejection(rule, pattern, opts) {
    const fingerprint = fpFingerprint(rule, pattern);
    const key = fingerprint;
    const threshold = DEFAULT_THRESHOLD;
    const userId = resolveLabelUserId(opts?.userId);
    const file = loadFile();
    const existing = file.entries.find((e) => e.fingerprint === fingerprint);
    if (existing) {
        return { fingerprint, confirmCount: existing.confirmCount, whitelisted: true };
    }
    const list = pendingConfirmations.get(key) || [];
    list.push({ userId, ts: new Date().toISOString() });
    pendingConfirmations.set(key, list);
    if (isCoordinatedSingleUserAttack(list)) {
        StructuredLogger.info({
            event: 'fp_whitelist_coordinated_blocked',
            fingerprint,
            rule,
            userId,
            count: list.length,
        });
        Logger.warn(`[fp-whitelist] Blocked coordinated FP whitelist (${list.length} same-user confirms in 1h): ${rule}`);
        return {
            fingerprint,
            confirmCount: list.length,
            whitelisted: false,
            blocked: true,
            reason: 'coordinated_single_user',
        };
    }
    const confirmCount = list.length;
    if (confirmCount >= threshold) {
        if (!hasFpQuorum(list)) {
            Logger.debug(`[fp-whitelist] Quorum pending for ${rule} (${confirmCount} confirms)`);
            return { fingerprint, confirmCount, whitelisted: false, reason: 'quorum_pending' };
        }
        file.entries.push({
            rule,
            pattern,
            fingerprint,
            confirmedAt: new Date().toISOString(),
            confirmCount,
        });
        saveFile(file);
        pendingConfirmations.delete(key);
        Logger.info(`[fp-whitelist] Whitelisted after ${confirmCount} confirmations: ${rule} / ${pattern}`);
        return { fingerprint, confirmCount, whitelisted: true };
    }
    Logger.debug(`[fp-whitelist] FP confirm ${confirmCount}/${threshold} for ${rule} / ${pattern}`);
    return { fingerprint, confirmCount, whitelisted: false };
}
export function isFpWhitelisted(rule, pattern) {
    const fingerprint = fpFingerprint(rule, pattern);
    const file = loadFile();
    return file.entries.some((e) => e.fingerprint === fingerprint);
}
export function listFpWhitelist() {
    return loadFile().entries;
}
export function clearFpWhitelistForTests() {
    pendingConfirmations.clear();
    const path = resolveWhitelistPath();
    if (existsSync(path)) {
        writeFileSync(path, JSON.stringify({ version: 1, entries: [] }, null, 2), 'utf-8');
    }
}
//# sourceMappingURL=fp-whitelist.js.map