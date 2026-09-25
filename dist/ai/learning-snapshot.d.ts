export declare function resolveSnapshotDir(): string;
/** Snapshot learning + baselines before a cycle applies weight changes. */
export declare function createLearningSnapshot(learningPath?: string, baselinesPath?: string): string | null;
export declare function listSnapshots(): string[];
/** Restore the most recent snapshot (rollback one step). */
export declare function rollbackLatestSnapshot(learningPath?: string, baselinesPath?: string): {
    ok: boolean;
    snapshotId?: string;
    reason?: string;
};
export declare function readSnapshotMeta(id: string): Record<string, unknown> | null;
//# sourceMappingURL=learning-snapshot.d.ts.map