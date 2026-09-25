import { evaluateThreatIntelGuard } from '../threat-intel-guard.js';
export const threatIntelStrategy = {
    name: 'threat-intel',
    evaluate({ normalized }, deps) {
        const decision = evaluateThreatIntelGuard(normalized);
        if (!decision)
            return null;
        return { ...decision, action: deps.resolveAction(decision.action) };
    },
};
//# sourceMappingURL=threat-intel-strategy.js.map