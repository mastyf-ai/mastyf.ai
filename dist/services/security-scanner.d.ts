import { SecurityReport, McpServerConfig } from '../types.js';
import { CveChecker } from '../scanners/cve-checker.js';
import { AuthProber } from '../scanners/auth-prober.js';
import { TypoSquatDetector } from '../scanners/typo-squat-detector.js';
import { SecretScanner } from '../scanners/secret-scanner.js';
import { CommandValidator } from '../scanners/command-validator.js';
/**
 * Orchestrates all security scanning for a single MCP server.
 * Runs CVE checks, auth probing, typo-squat detection, and secret scanning in parallel.
 */
export declare class SecurityScanner {
    private cveChecker;
    private authProber;
    private typoDetector;
    private secretScanner;
    private cmdValidator;
    constructor(cveChecker?: CveChecker, authProber?: AuthProber, typoDetector?: TypoSquatDetector, secretScanner?: SecretScanner, cmdValidator?: CommandValidator);
    scanServer(server: McpServerConfig): Promise<SecurityReport>;
    /** Check server display name and npm/uvx packages from command line */
    private scanTypoSquats;
}
export interface ScoringConfig {
    penalties: {
        cveCritical: number;
        cveHigh: number;
        cveMedium: number;
        noAuth: number;
        unencryptedTransport: number;
        typosquat: number;
        secretFound: number;
        cmdHigh: number;
        cmdMedium: number;
    };
    bonuses: {
        authPresent: number;
        mTLS: number;
        pinnedLockfile: number;
        sbomPresent: number;
    };
}
//# sourceMappingURL=security-scanner.d.ts.map