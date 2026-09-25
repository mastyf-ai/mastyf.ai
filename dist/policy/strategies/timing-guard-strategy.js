import { evaluateTimingGuard } from '../timing-guard.js';
export const timingGuardStrategy = {
    name: 'timing-guard',
    evaluate({ normalized }, deps) {
        const decision = evaluateTimingGuard(normalized);
        if (!decision)
            return null;
        return { ...decision, action: deps.resolveAction(decision.action) };
    },
};
//# sourceMappingURL=timing-guard-strategy.js.map