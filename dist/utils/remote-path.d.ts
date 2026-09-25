/**
 * VS Code Remote SSH path mapping — translate local IDE paths to remote workspace paths.
 */
export interface PathMapping {
    local: string;
    remote: string;
}
/** Parse MASTYF_AI_REMOTE_PATH_MAP (JSON object or `local=/remote` comma-separated pairs). */
export declare function parseRemotePathMap(raw?: string): PathMapping[];
export declare function isRemoteSshEnabled(): boolean;
/**
 * Map a local IDE path to its remote counterpart when Remote SSH is enabled.
 * Unmapped paths are returned unchanged (normalized to forward slashes).
 */
export declare function translatePath(localPath: string): string;
/** Apply translatePath to workspace / prefix env values used in policy checks. */
export declare function translatePathIfRemote(path: string): string;
//# sourceMappingURL=remote-path.d.ts.map