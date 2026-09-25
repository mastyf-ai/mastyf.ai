import { IndustryStandardStore } from '../../database/industry-standard-store.js';
import type { ReinforceFuzzerSelector } from '../rl/reinforce-fuzzer.js';
import type { MCPCertifier } from '../certification/certifier.js';
export interface FuzzPayload {
    id: string;
    category: string;
    payload: string;
    target: string;
    description: string;
}
export interface FuzzResult {
    payload: FuzzPayload;
    blocked: boolean;
    crashed: boolean;
    response: string;
    risk: 'critical' | 'high' | 'medium' | 'low';
}
export declare class McpProtocolFuzzer {
    private readonly store?;
    private results;
    constructor(store?: IndustryStandardStore | undefined);
    runFuzzer(blockFn: (method: string, params: Record<string, unknown>) => {
        blocked: boolean;
        reason?: string;
    }, serverName?: string, reinforce?: ReinforceFuzzerSelector): FuzzResult[];
    /** Live transport fuzz against MASTYF_AI_FUZZ_TARGET URL. */
    runLiveTransportFuzz(blockFn: (method: string, params: Record<string, unknown>) => {
        blocked: boolean;
        reason?: string;
    }, serverName?: string, reinforce?: ReinforceFuzzerSelector): Promise<FuzzResult[]>;
    /** Require silver+ certification before treating fuzz pass as production-ready. */
    passesCertGate(certifier: MCPCertifier, serverName: string, minLevel?: 'silver' | 'gold'): boolean;
    private expandWithReinforce;
    private applyMutationStrategy;
    private defaultBlock;
    getResults(): FuzzResult[];
    getStats(): {
        total: number;
        blocked: number;
        passed: number;
        crashed: number;
        criticalBypasses: number;
    };
    /** Promote crashes / critical bypasses into Vuln Discovery + threat research. */
    private promoteProtocolFindings;
}
//# sourceMappingURL=mcp-fuzzer.d.ts.map