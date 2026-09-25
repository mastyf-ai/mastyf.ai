/**
 * Per-tenant semantic layer overrides via MASTYF_AI_TENANT_SEMANTIC_JSON.
 *
 * Example:
 * {"acme":{"syncResponse":true,"async":true},"beta":{"syncResponse":false,"strict":true}}
 */
export interface TenantSemanticOverrides {
    localSemantic?: boolean;
    syncResponse?: boolean;
    syncResponseLlm?: boolean;
    syncRequest?: boolean;
    syncRequestLlm?: boolean;
    asyncAudit?: boolean;
    strict?: boolean;
}
/** @internal */
export declare function resetTenantSemanticConfigForTests(): void;
export declare function getTenantSemanticOverrides(tenantId?: string): TenantSemanticOverrides | undefined;
export declare function isLocalSemanticEnabledForTenant(tenantId?: string): boolean;
export declare function isLocalSemanticEnabledGlobal(): boolean;
/** Global sync-response gate — production defaults on unless explicitly disabled. */
export declare function isSyncSemanticResponseEnabledGlobal(): boolean;
export declare function isSyncSemanticResponseEnabledForTenant(tenantId?: string): boolean;
export declare function isSyncSemanticLlmEnabledForTenant(tenantId?: string): boolean;
export declare function isSemanticAsyncEnabledForTenant(tenantId?: string): boolean;
export declare function isSemanticStrictForTenant(tenantId?: string): boolean;
export declare function isEnterpriseMode(): boolean;
/** Sync request gate — ON by default in enterprise when LLM is available. */
export declare function isSyncSemanticRequestEnabledGlobal(): boolean;
export declare function isSyncSemanticRequestEnabledForTenant(tenantId?: string): boolean;
export declare function isSyncSemanticRequestLlmEnabledForTenant(tenantId?: string): boolean;
//# sourceMappingURL=tenant-semantic-config.d.ts.map