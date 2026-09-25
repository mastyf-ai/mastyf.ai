import { type ThreatLabCandidateRecord } from '../utils/swarm-artifacts.js';
export interface ProposeBlockResult {
    ok: boolean;
    reason?: string;
    candidateId?: string;
    fingerprint?: string;
    candidate?: ThreatLabCandidateRecord;
}
/** Create / upsert a pending Threat Lab candidate for operator Accept (applies YAML). */
export declare function proposeBlockFromFinding(findingId: string, opts?: {
    tenantId?: string;
    llm?: boolean;
}): Promise<ProposeBlockResult>;
//# sourceMappingURL=propose-block.d.ts.map