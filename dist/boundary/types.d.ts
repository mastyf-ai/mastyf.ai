/**
 * Mastyf Complete-Mediation Qualification (CMQ) Type Definitions.
 *
 * Operational mechanism for empirically qualifying A1 Complete Mediation:
 * Agent ↛ ProtectedSystem except through Agent → Mastyf → ProtectedSystem.
 */
export interface ProtectedServiceSpec {
    name: string;
    endpoint: string;
    protocol: 'mcp' | 'http' | 'https' | 'postgres' | 'tcp' | 'uds';
    requiredAuth?: string;
    expectedWorkloadIdentity?: string;
    imageDigest?: string;
}
export interface BoundaryManifest {
    version: string;
    deployment: {
        name: string;
        environment?: 'local' | 'docker' | 'kubernetes' | 'production' | string;
        platform?: 'darwin' | 'linux' | 'win32' | 'container' | string;
        cluster?: string;
        namespace?: string;
        agentImageDigest?: string;
        mastyfImageDigest?: string;
    };
    agent: {
        identity: string;
        network?: string;
        allowedCapabilities?: string[];
        restrictedEnv?: string[];
    };
    protectedServices: ProtectedServiceSpec[];
    mediation: {
        gateway: string;
        allowedIngress?: string[];
        allowedEgress?: string[];
        udsSocketPath?: string;
        mTLS?: boolean;
        failClosed: boolean;
    };
    credentials: {
        agentAccess: 'none' | string[];
        gatewayAccess: string[];
        canaryToken?: string;
    };
    policies?: {
        securityPolicyPath?: string;
        networkPolicyPath?: string;
        mcpConfigPath?: string;
    };
}
export type CMQEvidenceLevel = 'LEVEL_1_DECLARATIVE' | 'LEVEL_2_ENVIRONMENTAL' | 'LEVEL_3_ADVERSARIAL';
export interface TopologyFinding {
    id: string;
    level: CMQEvidenceLevel;
    category: 'network' | 'credentials' | 'socket' | 'shell' | 'process' | 'filesystem';
    title: string;
    severity: 'PASS' | 'WARN' | 'FAIL';
    detail: string;
    remediation?: string;
}
export interface TopologyInspectionReport {
    timestamp: string;
    deploymentName: string;
    platform: string;
    checksCount: number;
    passCount: number;
    warnCount: number;
    failCount: number;
    directRoutesDetected: number;
    credentialPathsDetected: number;
    protectedEndpointsExposed: number;
    verdict: 'INSPECT_PASSED' | 'INSPECT_WARNING' | 'INSPECT_FAILED';
    findings: TopologyFinding[];
}
export type CMQEscapeVector = 'normal_mcp_call' | 'direct_mcp_connection' | 'direct_http_api' | 'alternate_hostname_ip' | 'ipv6_bypass' | 'unix_socket_direct' | 'shell_escape' | 'subprocess_spawn' | 'env_credential_leak' | 'mounted_secrets_leak' | 'reused_credentials' | 'tool_chaining_escape' | 'concurrent_race_evasion' | 'fail_closed_direct_fallback' | 'tool_identity_spoofing';
export interface CMQSingleTestResult {
    vector: CMQEscapeVector;
    title: string;
    target: string;
    mediated: boolean;
    sideEffectObserved: boolean;
    networkBlocked: boolean;
    credentialDenied: boolean;
    result: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
    details: string;
}
export type CMQQualificationVerdict = 'QUALIFIED' | 'QUALIFIED_WITH_WARNINGS' | 'FAILED' | 'NOT_QUALIFIABLE';
export interface CMQEnvironmentEvidence {
    platform: 'kubernetes' | 'docker' | 'local' | string;
    cluster?: string;
    namespace?: string;
    agentImageDigest?: string;
    mastyfImageDigest?: string;
    toolImageDigests?: string[];
    hostArchitecture?: string;
    osVersion?: string;
}
export interface CMQConfigurationEvidence {
    manifestSha256: string;
    policySha256?: string;
    networkPolicySha256?: string;
    mcpConfigSha256?: string;
}
export interface CMQInspectionSummary {
    directRoutesDetected: number;
    credentialPathsDetected: number;
    protectedEndpointsExposed: number;
    findingsCount: number;
    verdict: 'INSPECT_PASSED' | 'INSPECT_WARNING' | 'INSPECT_FAILED';
}
export interface CMQTestSummary {
    vectors: number;
    passed: number;
    failed: number;
    unauthorizedSideEffects: number;
    unmediatedSuccesses: number;
}
export interface CMQAttestationReport {
    qualification: {
        id: string;
        deployment: string;
        verdict: CMQQualificationVerdict;
        timestamp: string;
        scope: string;
    };
    environment: CMQEnvironmentEvidence;
    configuration: CMQConfigurationEvidence;
    inspection: CMQInspectionSummary & {
        findings: TopologyFinding[];
    };
    tests: CMQTestSummary & {
        results: CMQSingleTestResult[];
    };
    attestation: {
        algorithm: 'Ed25519';
        keyId: string;
        signature: string;
        publicKeyPem: string;
        statement: string;
    };
    qualificationId: string;
    version: string;
    deploymentName: string;
    timestamp: string;
    scope: string;
    verdict: CMQQualificationVerdict;
    statement: string;
    summary: {
        protectedServicesCount: number;
        totalTestsRun: number;
        passedTests: number;
        failedTests: number;
        inconclusiveTests: number;
        unauthorizedSideEffectsObserved: number;
        unmediatedSuccessfulPaths: number;
    };
    testResults: CMQSingleTestResult[];
    hashes: {
        deploymentManifestHash: string;
        testSuiteVersion: string;
    };
    signature?: {
        algorithm: string;
        publicKeyPem: string;
        signatureBase64: string;
    };
}
//# sourceMappingURL=types.d.ts.map