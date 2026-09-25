/**
 * Feature tiers — MIT open source by default; optional cloud license enforcement.
 */
export declare const PRO_FEATURES: readonly ["dashboard", "websocket", "swarm", "ai", "audit", "metrics", "cost", "health", "fleet", "admin", "multi_tenant", "semantic_async", "policy"];
export type ProFeature = (typeof PRO_FEATURES)[number];
/** Always-on community features (also included in PRO_FEATURES for telemetry). */
export declare const COMMUNITY_FEATURES: readonly ["proxy", "cli", "policy_local", "dashboard", "websocket", "swarm", "ai", "audit", "metrics", "cost", "health", "fleet", "admin", "multi_tenant", "semantic_async", "policy"];
/** Open-source edition — feature gating disabled unless MASTYF_AI_REQUIRE_LICENSE=true. */
export declare function isOpenCoreEnabled(): boolean;
/** Test/CI license bypass — disabled in enterprise mode. */
export declare function isCiLicenseBypass(): boolean;
/** Warn/fail startup when enterprise mode has license bypass env set. */
export declare function assertEnterpriseLicensePosture(): void;
/** isDevUnlockAllowed removed in v3.2.3 — use a valid MASTYF_AI_LICENSE_KEY for local development. */
export declare const isDevUnlockAllowed: () => boolean;
/** Classifier only — does not gate access when license enforcement is off. */
export declare function isProFeature(feature: string): boolean;
export declare function allProFeatureNames(): ProFeature[];
export declare function getProCheckoutUrl(): string;
export declare function licenseTier(licensed: boolean): 'community' | 'pro';
//# sourceMappingURL=feature-tiers.d.ts.map