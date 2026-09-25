/**
 * SOAR playbooks — declarative rules that trigger webhooks and Threat Lab actions.
 */
import { readFileSync, existsSync } from 'fs';
import { Logger } from '../utils/logger.js';
import { alertPolicyBlock } from './webhook-alerter.js';
function fieldValue(event, field) {
    const parts = field.split('.');
    let cur = event;
    for (const p of parts) {
        if (cur == null || typeof cur !== 'object')
            return undefined;
        cur = cur[p];
    }
    return cur;
}
function evalCondition(event, cond) {
    const actual = fieldValue(event, cond.field);
    if (actual === undefined)
        return false;
    switch (cond.op) {
        case 'eq':
            return actual === cond.value;
        case 'neq':
            return actual !== cond.value;
        case 'gt':
            return Number(actual) > Number(cond.value);
        case 'gte':
            return Number(actual) >= Number(cond.value);
        case 'contains':
            return String(actual).toLowerCase().includes(String(cond.value).toLowerCase());
        default:
            return false;
    }
}
export function evaluatePlaybooks(event, playbooks) {
    const matches = [];
    for (const pb of playbooks) {
        if (pb.enabled === false)
            continue;
        if (!pb.when.every((c) => evalCondition(event, c)))
            continue;
        matches.push({ playbook: pb.name, actions: pb.actions });
    }
    return matches;
}
export function loadPlaybooksFromPath(path) {
    const p = path || process.env.MASTYF_AI_SOAR_PLAYBOOKS_PATH || 'config/soar-playbooks.json';
    if (!existsSync(p))
        return DEFAULT_PLAYBOOKS;
    try {
        const raw = JSON.parse(readFileSync(p, 'utf-8'));
        return raw.playbooks?.length ? raw.playbooks : DEFAULT_PLAYBOOKS;
    }
    catch {
        return DEFAULT_PLAYBOOKS;
    }
}
export const DEFAULT_PLAYBOOKS = [
    {
        name: 'high-confidence-semantic-run',
        when: [
            { field: 'event', op: 'eq', value: 'semantic_flag' },
            { field: 'confidence', op: 'gte', value: 0.9 },
            { field: 'toolName', op: 'contains', value: 'run' },
        ],
        actions: [
            { type: 'notify', severity: 'high', message: 'High-confidence semantic flag on run tool' },
            { type: 'open_threat_lab' },
            { type: 'suggest_policy_block' },
        ],
    },
    {
        name: 'tool-integrity-critical',
        when: [
            { field: 'event', op: 'eq', value: 'tool_integrity' },
            { field: 'severity', op: 'eq', value: 'critical' },
        ],
        actions: [
            { type: 'notify', severity: 'critical', message: 'Tool integrity critical — possible rug pull' },
            { type: 'pagerduty' },
        ],
    },
    {
        name: 'agent-abuse-critical',
        when: [
            { field: 'event', op: 'eq', value: 'agent_abuse' },
            { field: 'score', op: 'gte', value: 75 },
        ],
        actions: [
            { type: 'notify', severity: 'high', message: 'Agent abuse score critical' },
            { type: 'suggest_policy_block' },
        ],
    },
];
export async function executePlaybookActions(matches, event) {
    const results = [];
    for (const match of matches) {
        for (const action of match.actions) {
            try {
                switch (action.type) {
                    case 'notify':
                    case 'pagerduty':
                        await alertPolicyBlock(String(event.serverName || 'unknown'), String(event.toolName || 'unknown'), `soar:${match.playbook}`, action.message || `Playbook ${match.playbook} triggered`, String(event.requestId || event.id || ''));
                        results.push({ playbook: match.playbook, action: action.type, ok: true });
                        break;
                    case 'open_threat_lab':
                    case 'suggest_policy_block':
                        Logger.info(`[SOAR] ${match.playbook} → ${action.type} for ${event.toolName || event.serverName}`);
                        results.push({ playbook: match.playbook, action: action.type, ok: true });
                        break;
                    default:
                        results.push({ playbook: match.playbook, action: action.type, ok: false });
                }
            }
            catch {
                results.push({ playbook: match.playbook, action: action.type, ok: false });
            }
        }
    }
    return results;
}
export async function runSoarPlaybooks(event) {
    if (process.env.MASTYF_AI_SOAR_PLAYBOOKS !== 'true') {
        return { matches: [], results: [] };
    }
    const playbooks = loadPlaybooksFromPath();
    const matches = evaluatePlaybooks(event, playbooks);
    const results = await executePlaybookActions(matches, event);
    return { matches, results };
}
//# sourceMappingURL=soar-playbooks.js.map