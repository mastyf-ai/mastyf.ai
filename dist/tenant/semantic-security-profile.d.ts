/**
 * Semantic security profiles — balanced vs max-security env bundles.
 */
export type SemanticSecurityProfile = 'balanced' | 'max-security';
export declare function resolveSemanticSecurityProfile(): SemanticSecurityProfile | null;
/** Apply profile defaults without overriding explicitly set env vars. */
export declare function applySemanticSecurityProfile(profile?: SemanticSecurityProfile | null): void;
//# sourceMappingURL=semantic-security-profile.d.ts.map