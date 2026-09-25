/**
 * Hot-reloadable mTLS HTTPS agent registry.
 */
import { Agent as HttpsAgent } from 'https';
export declare function getMtlsAgent(): HttpsAgent | undefined;
export declare function reloadMtlsAgent(): void;
export declare function resetMtlsAgentForTests(): void;
//# sourceMappingURL=mtls-agent-registry.d.ts.map