import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { Logger } from '../utils/logger.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import { resolveAiBaselinesPath, resolveAiLearningStatePath } from './ai-paths.js';
const MAX_SNAPSHOTS = 5;
export function resolveSnapshotDir() {
    if (process.env.MASTYF_AI_AI_SNAPSHOT_DIR) {
        return process.env.MASTYF_AI_AI_SNAPSHOT_DIR;
    }
    return join(homedir(), '.mastyf-ai', 'learning-snapshots');
}
function snapshotId() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}
/** Snapshot learning + baselines before a cycle applies weight changes. */
export function createLearningSnapshot(learningPath = resolveAiLearningStatePath(), baselinesPath = resolveAiBaselinesPath()) {
    if (!existsSync(learningPath))
        return null;
    const dir = resolveSnapshotDir();
    mkdirSync(dir, { recursive: true });
    const id = snapshotId();
    const snapDir = join(dir, id);
    mkdirSync(snapDir, { recursive: true });
    copyFileSync(learningPath, join(snapDir, '.ai-learning.json'));
    if (existsSync(baselinesPath)) {
        copyFileSync(baselinesPath, join(snapDir, '.ai-baselines.json'));
    }
    writeFileSync(join(snapDir, 'meta.json'), JSON.stringify({ id, createdAt: new Date().toISOString(), learningPath, baselinesPath }, null, 2));
    pruneSnapshots(dir);
    Logger.debug(`[learning-snapshot] Created snapshot ${id}`);
    return id;
}
function pruneSnapshots(dir) {
    const entries = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    while (entries.length > MAX_SNAPSHOTS) {
        const oldest = entries.shift();
        if (oldest) {
            rmSync(join(dir, oldest), { recursive: true, force: true });
        }
    }
}
export function listSnapshots() {
    const dir = resolveSnapshotDir();
    if (!existsSync(dir))
        return [];
    return readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
        .reverse();
}
/** Restore the most recent snapshot (rollback one step). */
export function rollbackLatestSnapshot(learningPath = resolveAiLearningStatePath(), baselinesPath = resolveAiBaselinesPath()) {
    const snaps = listSnapshots();
    if (snaps.length === 0) {
        return { ok: false, reason: 'No learning snapshots available' };
    }
    const id = snaps[0];
    const snapDir = join(resolveSnapshotDir(), id);
    const learningSrc = join(snapDir, '.ai-learning.json');
    if (!existsSync(learningSrc)) {
        return { ok: false, reason: `Snapshot ${id} missing learning state` };
    }
    copyFileSync(learningSrc, learningPath);
    const baselineSrc = join(snapDir, '.ai-baselines.json');
    if (existsSync(baselineSrc)) {
        copyFileSync(baselineSrc, baselinesPath);
    }
    StructuredLogger.info({ event: 'ai_learning_rollback', snapshotId: id });
    Logger.warn(`[learning-snapshot] Rolled back to snapshot ${id}`);
    return { ok: true, snapshotId: id };
}
export function readSnapshotMeta(id) {
    const metaPath = join(resolveSnapshotDir(), id, 'meta.json');
    if (!existsSync(metaPath))
        return null;
    try {
        return JSON.parse(readFileSync(metaPath, 'utf-8'));
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=learning-snapshot.js.map