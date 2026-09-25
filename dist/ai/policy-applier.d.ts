import { PolicyRule } from '../policy/policy-types.js';
import { PolicyWatcher } from '../policy/policy-watcher.js';
/**
 * Merge an accepted suggestion into live policy YAML and hot-reload via PolicyWatcher.
 */
export declare function applySuggestionToPolicy(rule: PolicyRule, policyPath?: string | null, policyWatcher?: PolicyWatcher | null, opts?: {
    skipSimulation?: boolean;
    tenantId?: string;
}): Promise<{
    applied: boolean;
    policyPath: string | null;
    reason?: string;
    simulationSummary?: string;
}>;
/** Look up a rule by name in the policy YAML file. */
export declare function findPolicyRuleByName(ruleName: string, policyPath?: string | null): PolicyRule | null;
/**
 * Remove an existing policy rule by name and write updated YAML.
 */
export declare function removeSuggestionRuleFromPolicy(ruleName: string, policyPath?: string | null, policyWatcher?: PolicyWatcher | null): {
    removed: boolean;
    policyPath: string | null;
    reason?: string;
};
//# sourceMappingURL=policy-applier.d.ts.map