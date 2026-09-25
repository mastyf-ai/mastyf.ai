import { getAgenticContainer, isAgenticEnabled } from '../../utils/agentic-container.js';
const LEVEL_RANK = {
    bronze: 1,
    silver: 2,
    gold: 3,
    platinum: 4,
};
export function certLevelMeets(actual, required) {
    return LEVEL_RANK[actual] >= LEVEL_RANK[required];
}
export function parseCertLevel(raw) {
    const v = String(raw ?? '').toLowerCase();
    if (v === 'bronze' || v === 'silver' || v === 'gold' || v === 'platinum')
        return v;
    return null;
}
export const certificationStrategy = {
    name: 'require-certification',
    evaluate({ normalized }, deps) {
        const required = parseCertLevel(deps.config.policy.require_certification);
        if (!required || !isAgenticEnabled())
            return null;
        const container = getAgenticContainer();
        if (!container?.certifier)
            return null;
        const cert = container?.certifier.getCertification(normalized.serverName);
        if (!cert || !cert.certified) {
            return {
                action: deps.resolveAction('block'),
                rule: 'require-certification',
                reason: `Server ${normalized.serverName} is not certified (required: ${required})`,
            };
        }
        if (!certLevelMeets(cert.level, required)) {
            return {
                action: deps.resolveAction('block'),
                rule: 'require-certification',
                reason: `Server ${normalized.serverName} certification ${cert.level} below required ${required}`,
            };
        }
        return null;
    },
};
//# sourceMappingURL=certification-strategy.js.map