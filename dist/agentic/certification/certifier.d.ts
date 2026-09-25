import { IndustryStandardStore } from '../../database/industry-standard-store.js';
import { MastyfAiScore, type ScoreInput } from '../trust-score/mastyf-ai-score.js';
import type { ReputationNetwork } from '../reputation/reputation-network.js';
export interface CertificationResult {
    serverName: string;
    packageName: string;
    version: string;
    certified: boolean;
    level: 'bronze' | 'silver' | 'gold' | 'platinum';
    score: number;
    checks: CertificationCheck[];
    signedAttestation?: string;
    issuedAt: string;
    expiresAt: string;
    registeredInRegistry: boolean;
}
export interface CertificationCheck {
    id: string;
    name: string;
    passed: boolean;
    score: number;
    maxScore: number;
    details: string;
}
export interface CertifyManualInputs {
    trustScore: number;
    complianceScore: number;
    cveFree: boolean;
    authMethod: string;
    transport: string;
    trustedPublisher: boolean;
    /** Protocol/tool fuzz critical failures — blocks certification when > 0 */
    fuzzCriticalFailures?: number;
}
export declare class MCPCertifier {
    private readonly store?;
    private readonly reputationNetwork?;
    private registry;
    private readonly mastyfAiScore;
    constructor(store?: IndustryStandardStore | undefined, mastyfAiScore?: MastyfAiScore, reputationNetwork?: ReputationNetwork | undefined);
    /** Auto-collect certification inputs from MastyfAiScore + CVE posture. */
    collectFromMastyfAiScore(input: Partial<ScoreInput> & {
        serverName: string;
    }): CertifyManualInputs;
    certify(serverName: string, packageName: string, version: string, results: CertifyManualInputs): CertificationResult;
    certifyFromScan(serverName: string, packageName: string, version: string, scan: Partial<ScoreInput>): CertificationResult;
    getCertification(serverName: string): CertificationResult | undefined;
    listCertified(): CertificationResult[];
    verifyCertification(serverName: string, attestationJws?: string): {
        valid: boolean;
        level?: CertificationResult['level'];
        reason?: string;
    };
}
//# sourceMappingURL=certifier.d.ts.map