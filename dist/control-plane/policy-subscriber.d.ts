import type { PolicyWatcher } from '../policy/policy-watcher.js';
export declare function isPolicySubscriberEnabled(): boolean;
export declare function fetchAndApplyCloudPolicy(tenantSlug: string, policyWatcher?: PolicyWatcher | null): Promise<{
    applied: boolean;
    version: number;
}>;
export declare function startPolicySubscriber(tenantSlug: string, policyWatcher?: PolicyWatcher | null): void;
export declare function stopPolicySubscriber(): void;
export declare function resetPolicySubscriberForTests(): void;
//# sourceMappingURL=policy-subscriber.d.ts.map