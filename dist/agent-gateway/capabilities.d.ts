/** Where a control is legitimately decided. See the module note. */
export type EnforcementPoint = 'gateway' | 'upstream' | 'desktop-only';
/**
 * `live`       -- fully operational here.
 * `degraded`   -- operational, but with a known, stated loss of fidelity.
 * `unavailable`-- not running; something downstream is being skipped silently.
 */
export type CapabilityState = 'live' | 'degraded' | 'unavailable';
export interface Capability {
    id: string;
    state: CapabilityState;
    enforcement: EnforcementPoint;
    /** Always non-empty: the specific reason, not a generic label. */
    detail: string;
}
/**
 * MCP methods this authorizer acts on.
 *
 * `authorized` is decided by `decision-core.ts`'s parser. `unauthorized` is
 * equally important: those methods are *not blocked* by this service -- they are
 * simply never presented to it, so nothing is enforced on them. Conflating the
 * two would be the dishonest outcome.
 */
export interface ProtocolCoverage {
    authorized: string[];
    /** Parsed and refused by this service. */
    denied: string[];
    /** Never reach this service. No verdict is produced for them here. */
    unauthorized: string[];
    /** Traffic that is not MCP JSON-RPC at all. */
    nonMcpTraffic: string;
}
export declare const AUTHORIZED_MCP_METHODS: readonly ["tools/call"];
export declare const DENIED_MCP_METHODS: readonly ["unrecognised-payload", "unauthorised-method", "empty-payload", "payload-too-large", "arguments-too-large-for-authorization", "unserialisable-arguments", "fail-closed-invariant"];
export declare const UNAUTHORIZED_MCP_METHODS: readonly ["initialize", "ping", "tools/list", "prompts/get", "prompts/list", "resources/read", "resources/list", "resources/subscribe", "completion/complete", "logging/setLevel", "notifications/*"];
/** Builds the protocol half of the report. */
export declare function buildProtocolCoverage(): ProtocolCoverage;
export interface BuildReportOptions {
    /** How `requestTokens` is populated, so the report cannot drift from the code. */
    requestTokensMode: 'estimated' | 'zeroed';
}
/**
 * Assembles the full report from live runtime state.
 *
 * Deliberately a pure function of the environment and container so the
 * conformance harness can assert on it without a socket.
 */
export declare function buildCapabilityReport(options: BuildReportOptions): {
    protocol: ProtocolCoverage;
    capabilities: Capability[];
};
/** Ids that must be `live` for the authorizer to be considered fully operational. */
export declare const REQUIRED_LIVE_CAPABILITIES: readonly ["mcp-certification", "behavioral-biometrics", "zero-trust"];
export interface ReportRejection {
    id: string;
    detail: string;
}
/**
 * Returns the required capabilities that are not live.
 *
 * Used to refuse startup. A security authorizer that boots with its primary
 * strategies silently disabled is worse than one that does not boot, because
 * the refusal is visible and the degradation is not.
 */
export declare function findMissingRequired(report: {
    capabilities: Capability[];
}, required?: readonly string[]): ReportRejection[];
/** Renders the report as aligned text for startup logs. */
export declare function formatCapabilityReport(report: {
    protocol: ProtocolCoverage;
    capabilities: Capability[];
}): string;
export declare const CAPABILITY_ARTIFACT_SCHEMA_VERSION = 1;
export interface CapabilityArtifact {
    schemaVersion: number;
    protocol: ProtocolCoverage;
    capabilities: Capability[];
}
/**
 * Deterministic, diff-stable projection of the report. Intentionally carries no
 * timestamp, hostname, or PID: the point is to commit this file and diff it
 * across builds, so anything that varies per run would guarantee false drift.
 */
export declare function buildCapabilityArtifact(report: {
    protocol: ProtocolCoverage;
    capabilities: Capability[];
}): CapabilityArtifact;
/**
 * Compares a committed baseline against a live report and returns human-readable
 * drift lines (empty when they agree).
 *
 * Only `state` and `enforcement` are compared. `detail` is deliberately
 * excluded: it is explanatory prose that gets reworded freely, and failing a
 * deploy because someone rewrote a sentence would train operators to ignore the
 * gate. The state is the security-relevant fact -- `live` versus `degraded` is
 * the difference between an enforced control and a silent no-op.
 */
export declare function diffCapabilityArtifact(baseline: CapabilityArtifact, report: {
    protocol: ProtocolCoverage;
    capabilities: Capability[];
}): string[];
//# sourceMappingURL=capabilities.d.ts.map