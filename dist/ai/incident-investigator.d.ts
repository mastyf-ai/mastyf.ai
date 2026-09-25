/**
 * Agentic Incident Investigator — multi-step analysis with cited audit records and Threat Lab bridge.
 */
import { type StoredSemanticAudit } from './semantic-audit-store.js';
import { type FlowEvent } from '../policy/session-flow-store.js';
import { type AgentIntentGraph } from './agent-intent-graph.js';
export type IncidentCitation = {
    id: string;
    kind: 'semantic_audit' | 'flow_event' | 'related_call';
    summary: string;
    timestamp?: string;
};
export type IncidentHypothesis = {
    attackClass: string;
    confidence: number;
    reasoning: string;
    citations: string[];
};
export type IncidentRecommendation = {
    action: 'review_policy' | 'open_threat_lab' | 'label_semantic' | 'quarantine_session';
    detail: string;
    threatLabContext?: {
        toolName: string;
        category: string;
        semanticAuditId: string;
    };
};
export type IncidentInvestigation = {
    incidentId: string;
    triggerId: string;
    triggerType: 'semantic_flag' | 'repeat_block' | 'swarm_bypass';
    generatedAt: string;
    citations: IncidentCitation[];
    sessionFlow: FlowEvent[];
    relatedRecords: StoredSemanticAudit[];
    hypotheses: IncidentHypothesis[];
    recommendations: IncidentRecommendation[];
    narrative?: string;
    killChainNarrative?: string;
    intentGraph?: AgentIntentGraph;
    threatLabReady: boolean;
};
export declare function investigateIncident(opts: {
    triggerId: string;
    triggerType?: IncidentInvestigation['triggerType'];
    tenantId?: string;
    useLlm?: boolean;
}): Promise<IncidentInvestigation | null>;
//# sourceMappingURL=incident-investigator.d.ts.map