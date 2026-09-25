/**
 * Bridge semantic audit true-positives → pending policy suggestions via Threat Lab.
 */
import { discoverFromSemanticAudit, validateThreatLabDiscovery } from './threat-lab.js';
import { queuePendingAttackSuggestion } from './instant-attack-learning.js';
import { attackMinConfidence } from './attack-pattern-learner.js';
import { Logger } from '../utils/logger.js';
export async function bridgeSemanticAuditToSuggestion(record) {
    if (record.label !== 'true_positive') {
        return false;
    }
    const discovery = await discoverFromSemanticAudit(record);
    if (!discovery)
        return false;
    const validation = validateThreatLabDiscovery(discovery, { requireReplayBlock: true });
    if (!validation.ok) {
        Logger.debug(`[semantic-bridge] rejected: ${validation.errors.join('; ')}`);
        return false;
    }
    if (discovery.confidence < attackMinConfidence()) {
        Logger.debug('[semantic-bridge] below min confidence — skipping queue');
        return false;
    }
    try {
        const { promoteDiscoveryToCoreRules } = await import('./core-rule-promoter.js');
        promoteDiscoveryToCoreRules(discovery, {
            source: 'semantic-tp',
            inputFingerprint: record.id,
            confidence: discovery.confidence,
        });
    }
    catch {
        /* non-fatal */
    }
    return queuePendingAttackSuggestion({
        rule: discovery.policyRule,
        confidence: discovery.confidence,
        reason: `Threat Lab from semantic audit ${record.id}: ${discovery.hypothesis}`,
        source: 'attack',
    }, { source: 'threat-lab-semantic', tenantId: record.tenantId });
}
//# sourceMappingURL=semantic-to-suggestion.js.map