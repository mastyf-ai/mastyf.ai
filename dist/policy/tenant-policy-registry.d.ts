import { PolicyEngine } from './policy-engine.js';
import type { PolicyConfig } from './policy-types.js';
export declare class TenantPolicyRegistry {
    private cache;
    private baseEngine;
    private baseConfig;
    constructor(baseEngine?: PolicyEngine | null, baseConfig?: PolicyConfig | null);
    setBase(engine: PolicyEngine, config?: PolicyConfig): void;
    getEngine(tenantId: string): PolicyEngine | null;
    private mergeConfigs;
    clearCache(): void;
}
//# sourceMappingURL=tenant-policy-registry.d.ts.map