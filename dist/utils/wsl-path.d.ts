/**
 * Windows / WSL2 path normalization for policy path guards.
 * Maps /mnt/c/... and \\wsl$\Distro\... to Windows-style paths when enabled.
 */
/** Convert /mnt/<drive>/... to C:/... */
export declare function wslMountToWindows(path: string): string | null;
/** Convert \\wsl$\Distro\home\user\... to /home/user/... (Linux side). */
export declare function wslUncToLinux(path: string): string | null;
export declare function isWslPathMappingEnabled(): boolean;
/**
 * Normalize paths that cross Windows ↔ WSL boundaries before path-guard evaluation.
 */
export declare function translateWslPath(input: string): string;
//# sourceMappingURL=wsl-path.d.ts.map