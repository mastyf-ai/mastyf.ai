import type { McpServerConfig } from '../types.js';
/** Never readable or writable through the proxy, wherever they sit. Matched per path segment, any case. */
export declare const BUILTIN_DENIED_PATHS: string[];
/**
 * Folders the built-in guard allows: the container paths plus every folder the user named in a local
 * server's own arguments (for example the directory given to server-filesystem). Nothing else, so the
 * home folder as a whole is not opened. MASTYF_AI_ALLOWED_PATHS (comma separated) replaces the list.
 */
export declare function defaultAllowedPaths(configs?: McpServerConfig[], env?: NodeJS.ProcessEnv): string[];
/** Why this path is refused, or null when it is fine. */
export declare function checkPath(input: string, allowed: string[], denied: string[]): string | null;
//# sourceMappingURL=workspace-path-guard.d.ts.map