import { evaluateCveGate } from '../utils/cve-gate.js';
import { isRugPullBlockedForCall } from './rug-pull-transport.js';
import { evaluateToolRegistrationGate, registerToolsFromList, } from './tool-registration-gate.js';
export async function runLifecycleAssuranceGates(input) {
    if (input.rugPullState) {
        const rugPull = await isRugPullBlockedForCall(input.rugPullState, input.serverName, input.tenantId);
        if (rugPull) {
            return {
                block: true,
                phase: 'rug-pull',
                rule: 'tool-fingerprint-mismatch',
                reason: 'Tool catalog changed mid-session (rug-pull protection)',
                code: -32001,
            };
        }
    }
    if (input.db) {
        const cve = await evaluateCveGate(input.db, input.serverName);
        if (cve.block) {
            return {
                block: true,
                phase: 'cve',
                rule: 'cve-gate',
                reason: cve.reason ?? 'Server blocked due to CVE policy',
                code: -32001,
            };
        }
    }
    const reg = evaluateToolRegistrationGate(input.serverName, input.toolName);
    if (reg.block) {
        return {
            block: true,
            phase: 'registration',
            rule: reg.rule ?? 'registration-corpus-critical',
            reason: reg.reason ?? 'Tool blocked by registration scan',
            code: -32001,
        };
    }
    return { block: false };
}
export function onToolsListObserved(serverName, tools) {
    registerToolsFromList(serverName, tools);
}
//# sourceMappingURL=lifecycle-assurance-gates.js.map