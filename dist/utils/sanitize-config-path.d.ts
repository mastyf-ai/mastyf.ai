/**
 * Sanitise user-supplied configPath to prevent path-traversal and symlink escape.
 * Resolves symlinks via realpath; allows home, CWD, and common MCP/CI locations.
 */
export declare function sanitizeConfigPath(input: string): string | null;
//# sourceMappingURL=sanitize-config-path.d.ts.map