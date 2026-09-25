import type { McpServerConfig } from '../types.js';
/** Skip paths, URLs, and numeric npx/uvx args that are not package names. */
export declare function isLikelyPackageArg(arg: string): boolean;
/**
 * Extract npm/PyPI package identifiers from MCP server command lines.
 */
export declare function extractPackagesFromServer(server: Pick<McpServerConfig, 'command' | 'args' | 'packageName'>): string[];
/** Locate a lockfile near a path (walks up to maxUp parents). */
export declare function findLockfileNearPath(startPath: string, maxUp?: number): string | null;
/** Best-effort package install root for SBOM / transitive CVE scanning. */
export declare function resolvePackageRootFromServer(server: Pick<McpServerConfig, 'command' | 'args' | 'packageName'>): string | null;
//# sourceMappingURL=package-extractor.d.ts.map