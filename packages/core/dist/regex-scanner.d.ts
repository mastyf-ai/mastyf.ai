import type { Issue, ToolDefinition } from "./types.js";
export interface RegexScanOptions {
    /** TR39 confusables + NFKC before pattern match (default: true). */
    unicodeStrict?: boolean;
}
export declare function runRegexScan(tool: ToolDefinition, options?: RegexScanOptions): Issue[];
//# sourceMappingURL=regex-scanner.d.ts.map