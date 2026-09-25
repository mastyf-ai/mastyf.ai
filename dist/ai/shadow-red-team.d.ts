import type { ServerToolBaseline } from './tool-integrity-watch.js';
import { type ThreatSignature } from '../utils/fleet-threat-signatures.js';
import { PolicyEngine } from '../policy/policy-engine.js';
export type ShadowProbeCase = {
    id: string;
    persona: string;
    serverName: string;
    toolName: string;
    arguments: Record<string, unknown>;
    description: string;
    source: 'corpus' | 'red_team_persona';
};
export type ShadowProbeResult = {
    caseId: string;
    persona: string;
    toolName: string;
    serverName: string;
    wouldBlock: boolean;
    matchedRule?: string;
    action: string;
    bypass: boolean;
    detail: string;
};
export type ShadowRedTeamRun = {
    runId: string;
    startedAt: string;
    completedAt: string;
    baselineFingerprint?: string;
    policyPath: string;
    probes: ShadowProbeResult[];
    bypassCount: number;
    newBypasses: number;
    threatLabQueued: boolean;
    threatLabProcessed?: number;
};
export declare function loadToolBaseline(path?: string): ServerToolBaseline[];
export declare function generateShadowProbes(baselines: ServerToolBaseline[], limit?: number): ShadowProbeCase[];
export declare function runShadowProbes(probes: ShadowProbeCase[], engine: PolicyEngine): ShadowProbeResult[];
export declare function runShadowRedTeam(opts?: {
    baselinePath?: string;
    probeLimit?: number;
    writeReport?: boolean;
    queueThreatLab?: boolean;
}): Promise<ShadowRedTeamRun>;
export declare function shadowBypassThreatSignatures(run: ShadowRedTeamRun, probes: ShadowProbeCase[]): ThreatSignature[];
//# sourceMappingURL=shadow-red-team.d.ts.map