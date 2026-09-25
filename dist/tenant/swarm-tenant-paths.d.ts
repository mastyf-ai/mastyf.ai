declare const REPO_ROOT: string;
export declare const LEGACY_SWARM_DIR: string;
/** Output dir for swarm / Threat Lab / auto-research (dashboard sets MASTYF_AI_SWARM_DIR). */
export declare function resolveSwarmOutputDir(): string;
/** Writable/read path for a tenant's swarm artifacts. */
export declare function resolveTenantSwarmDir(tenantId: string): string;
/** Resolve dir for reads: tenant dir only (no committed legacy artifacts unless opted in). */
export declare function getEffectiveSwarmDir(tenantId: string): string;
export declare function resolveTenantPolicyAuditPath(tenantId: string): string;
export { REPO_ROOT };
//# sourceMappingURL=swarm-tenant-paths.d.ts.map