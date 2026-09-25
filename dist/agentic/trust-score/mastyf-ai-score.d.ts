/**
 * MCP Mastyf AI Trust Score — Like SSL Labs for MCP servers.
 *
 * Computes a 0-100 trust score per MCP server based on:
 *   1. CVE posture (known CVEs × CVSS severity, exploit maturity)
 *   2. Authentication strength (none < API key < OAuth2 < OAuth2+mTLS)
 *   3. Transport security (stdio < HTTP < HTTPS < mTLS)
 *   4. Tool capability risk surface (read vs write vs exec vs network)
 *   5. Supply chain integrity (trusted publisher, no typo-squat, no dep confusion)
 *   6. Observed attack history (blocked calls, bypasses, incident frequency)
 *   7. Response hygiene (does the server leak secrets/PII in responses?)
 *   8. Configuration freshness (last patched, age of known CVEs)
 *
 * Score tiers:
 *   A+ (90-100): Enterprise-ready
 *   A  (80-89):  Production-ready
 *   B  (60-79):  Needs hardening
 *   C  (40-59):  Significant gaps
 *   D  (20-39):  High risk
 *   F  (0-19):   Unsafe
 */
import { type TrustGrade } from './trust-badge-grade.js';
export interface TrustScore {
    serverName: string;
    /** Overall score 0-100 */
    overallScore: number;
    /** Letter grade */
    grade: TrustGrade;
    /** Per-category breakdowns */
    categories: ScoreCategory[];
    /** When this score was computed */
    computedAt: string;
    /** Whether this score includes live data (vs static analysis only) */
    includesLiveData: boolean;
    /** Recommended actions to improve score */
    improvementActions: ImprovementAction[];
    /** Badge data for display */
    badge: TrustBadge;
}
export interface ScoreCategory {
    name: string;
    score: number;
    weight: number;
    maxScore: number;
    details: string;
    findings: string[];
}
export interface ImprovementAction {
    priority: 'immediate' | 'high' | 'medium' | 'low';
    category: string;
    action: string;
    expectedScoreIncrease: number;
    effort: 'hours' | 'days' | 'weeks';
}
export interface TrustBadge {
    grade: string;
    color: string;
    text: string;
    pngDataUrl?: string;
}
export interface ScoreInput {
    serverName: string;
    /** Number of known CVEs */
    cveCount: number;
    /** Maximum CVSS score among known CVEs */
    maxCvss: number;
    /** Days since last CVE was published */
    newestCveAgeDays: number;
    /** Authentication method */
    authMethod: 'none' | 'api_key' | 'oauth2' | 'oauth2_mtls';
    /** Transport type */
    transport: 'stdio' | 'http' | 'https' | 'mTLS';
    /** High-risk tool count (execute, shell, delete, deploy, admin) */
    highRiskToolCount: number;
    /** Medium-risk tool count (write, update, create, send) */
    mediumRiskToolCount: number;
    /** Total tool count */
    totalToolCount: number;
    /** Whether the package is from a trusted publisher */
    trustedPublisher: boolean;
    /** Whether typo-squatting was detected */
    typoSquatDetected: boolean;
    /** Whether dependency confusion was detected */
    depConfusionDetected: boolean;
    /** Number of blocked calls (attack attempts) */
    blockedCalls: number;
    /** Number of bypassed attacks */
    bypassedAttacks: number;
    /** Whether response DLP is active */
    responseDlpActive: boolean;
    /** Whether the server is behind a Mastyf AI proxy */
    mastyfAiProtected: boolean;
}
export declare class MastyfAiScore {
    /**
     * Compute a trust score from available inputs.
     */
    compute(input: ScoreInput): TrustScore;
    /** Score CVE posture (0-100, weight 0.25) */
    private scoreCvePosture;
    /** Score authentication strength (0-100, weight 0.15) */
    private scoreAuthentication;
    /** Score transport security (0-100, weight 0.15) */
    private scoreTransport;
    /** Score tool capability risk (0-100, weight 0.12) */
    private scoreCapability;
    /** Score supply chain integrity (0-100, weight 0.12) */
    private scoreSupplyChain;
    /** Score attack history (0-100, weight 0.10) */
    private scoreAttackHistory;
    /** Score response hygiene / DLP (0-100, weight 0.06) */
    private scoreResponseHygiene;
    /** Score Mastyf AI protection layer (0-100, weight 0.05) */
    private scoreProtectionLayer;
    /** Compute letter grade. */
    private computeGrade;
    /** Compute badge. */
    private computeBadge;
    /** Generate improvement actions. */
    private generateImprovements;
}
//# sourceMappingURL=mastyf-ai-score.d.ts.map