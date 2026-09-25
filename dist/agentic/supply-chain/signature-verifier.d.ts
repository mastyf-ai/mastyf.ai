/**
 * Supply Chain Signature Verifier — verifies package signatures and
 * detects dependency confusion, typo-squatting at the dependency level,
 * and builds a transitive trust graph for MCP server packages.
 */
export interface PackageVerificationResult {
    packageName: string;
    version: string;
    verified: boolean;
    /** Whether the package was signed by a trusted publisher */
    trustedPublisher: boolean;
    /** Whether dependency confusion was detected */
    dependencyConfusion: boolean;
    /** Whether the name resembles a known package (typo-squatting) */
    typoSquat: boolean;
    /** Similar known packages */
    similarPackages: string[];
    /** Transitive dependencies (first level) */
    dependencies: DependencyInfo[];
    /** Overall integrity score 0-100 */
    integrityScore: number;
    /** Issues found */
    issues: SupplyChainIssue[];
}
export interface DependencyInfo {
    name: string;
    version: string;
    /** Whether this dep is from a known trusted publisher */
    trusted: boolean;
    /** Is this a newly introduced dep not in the previous version */
    newlyAdded: boolean;
}
export interface SupplyChainIssue {
    severity: 'critical' | 'high' | 'medium' | 'low';
    type: 'unsigned' | 'dependency_confusion' | 'typo_squat' | 'new_untrusted_dep' | 'version_mismatch';
    description: string;
    recommendation: string;
}
export declare class SignatureVerifier {
    /** Known MCP server packages to check against for typo-squatting */
    private readonly knownMcpPackages;
    /**
     * Verify a package's supply chain integrity.
     */
    verify(packageName: string, version: string, knownDeps?: DependencyInfo[], previousDeps?: string[]): PackageVerificationResult;
    /**
     * Check if the package is from a known trusted publisher.
     */
    private isTrustedPublisher;
    /**
     * Detect potential dependency confusion.
     */
    private detectDependencyConfusion;
    /**
     * Check if a package name is a typo-squat of a known package.
     */
    private checkTypoSquat;
    /**
     * Compute Levenshtein distance between two strings.
     */
    private levenshtein;
}
//# sourceMappingURL=signature-verifier.d.ts.map