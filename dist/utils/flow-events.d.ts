export type FlowStepKind = 'tool_call' | 'policy_block' | 'policy_pass' | 'semantic_queued' | 'semantic_complete' | 'ai_suggestion' | 'swarm_phase' | 'swarm_done' | 'swarm_failed' | 'analysis_ready';
export type FlowStepSeverity = 'info' | 'warn' | 'error' | 'success';
export interface FlowStep {
    id: string;
    kind: FlowStepKind;
    title: string;
    summary: string;
    severity: FlowStepSeverity;
    serverName?: string;
    toolName?: string;
    requestId?: string;
    metadata?: Record<string, unknown>;
}
export declare function emitFlowStep(step: Omit<FlowStep, 'id'> & {
    id?: string;
}): void;
//# sourceMappingURL=flow-events.d.ts.map