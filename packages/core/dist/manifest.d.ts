import type { ToolDefinition, ManifestVerifyResult } from "./types.js";
export declare const MIN_MANIFEST_SECRET_LENGTH = 32;
export declare class ManifestSecretError extends Error {
    name: string;
}
/** @internal */
export declare function resetManifestSecretForTests(): void;
/** @internal */
export declare function setManifestSecretForTests(secret: string): void;
/** @internal */
export declare function setManifestPathForTests(path: string | null): void;
/**
 * Resolve HMAC secret for tool manifest pinning.
 * Priority: test override → MASTYF_AI_MANIFEST_SECRET env → ~/.mastyf-ai/.local-secret (auto-generated).
 * No hardcoded default is ever used.
 */
export declare function resolveManifestSecret(): string;
export declare function verifyToolDefinitions(tools: ToolDefinition[], serverName: string): ManifestVerifyResult;
export declare function approveToolDefinitions(tools: ToolDefinition[], serverName: string): void;
//# sourceMappingURL=manifest.d.ts.map