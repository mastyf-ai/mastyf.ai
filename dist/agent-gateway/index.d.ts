import type { PolicyConfig } from '../policy/policy-types.js';
import { type ProtocolCoverage, type Capability } from './capabilities.js';
/**
 * Strict mode without shared state is a startup error, checked here so the
 * reason is attributable.
 *
 * `createContainer` already calls `process.exit(1)` for this combination
 * (`container.ts`, the Redis-not-configured branch), but reaching it means
 * exiting from several frames deep with no indication of which precondition
 * failed. Checking first turns a crashloop into one named error.
 *
 * Only applies to multi-replica or Kubernetes: on a single replica the
 * in-process caches are the whole world, so there is nothing global to lose.
 */
/**
 * Writes the machine-readable capability artifact and enforces the drift gate.
 *
 * Returns `null` when serving may continue, or a refusal reason. Kept as a
 * returned string rather than an inline `process.exit` so it is testable --
 * an inline exit is indistinguishable from a crashloop in a deploy log.
 *
 * Both halves are opt-in so the read-only default image touches nothing:
 *   MASTYF_AGENT_GATEWAY_CAPABILITY_REPORT    -- path to write the artifact to
 *   MASTYF_AGENT_GATEWAY_CAPABILITY_BASELINE  -- committed artifact to diff against
 *
 * Configuring a baseline is an explicit opt-in to failing the deploy, so a
 * capability that silently loses `live` blocks instead of shipping.
 */
export declare function publishCapabilityArtifact(report: {
    protocol: ProtocolCoverage;
    capabilities: Capability[];
}): Promise<string | null>;
export declare function strictModePrecondition(): string | null;
export declare function loadPolicyConfig(policyPath: string | undefined): PolicyConfig;
export declare function start(): Promise<void>;
//# sourceMappingURL=index.d.ts.map