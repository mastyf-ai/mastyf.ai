import type { SecretFinding } from '../types.js';
type CompiledRule = {
    id: string;
    provider: string;
    severity: string;
    regex: RegExp;
    entropy?: number;
    exclusions?: RegExp[];
};
/** Exported for tests and transparency dashboards. */
export declare function getSecretRuleCount(): number;
/** Compiled rules (regex pre-built at module load). */
export declare function getRules(): CompiledRule[];
export declare function scanForSecrets(target: string, context: string, opts?: {
    toolName?: string;
    fieldName?: string;
}): SecretFinding[];
export declare function scanAdjacentFiles(configDir: string): SecretFinding[];
export declare class SecretScanner {
    scan(serverConfig: {
        name: string;
        args?: string[];
        env?: Record<string, string>;
        command?: string;
    }): SecretFinding[];
}
export {};
//# sourceMappingURL=secret-scanner.d.ts.map