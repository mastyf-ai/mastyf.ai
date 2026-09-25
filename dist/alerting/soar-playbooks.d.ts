export type PlaybookCondition = {
    field: string;
    op: 'eq' | 'neq' | 'gt' | 'gte' | 'contains';
    value: string | number | boolean;
};
export type PlaybookAction = {
    type: 'notify' | 'open_threat_lab' | 'suggest_policy_block' | 'pagerduty';
    message?: string;
    severity?: 'critical' | 'high' | 'medium';
};
export type Playbook = {
    name: string;
    enabled?: boolean;
    when: PlaybookCondition[];
    actions: PlaybookAction[];
};
export type PlaybookEvent = Record<string, unknown>;
export type PlaybookMatch = {
    playbook: string;
    actions: PlaybookAction[];
};
export declare function evaluatePlaybooks(event: PlaybookEvent, playbooks: Playbook[]): PlaybookMatch[];
export declare function loadPlaybooksFromPath(path?: string): Playbook[];
export declare const DEFAULT_PLAYBOOKS: Playbook[];
export declare function executePlaybookActions(matches: PlaybookMatch[], event: PlaybookEvent): Promise<Array<{
    playbook: string;
    action: string;
    ok: boolean;
}>>;
export declare function runSoarPlaybooks(event: PlaybookEvent): Promise<{
    matches: PlaybookMatch[];
    results: Array<{
        playbook: string;
        action: string;
        ok: boolean;
    }>;
}>;
//# sourceMappingURL=soar-playbooks.d.ts.map