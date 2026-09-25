import { evaluateResourceGuard } from '../resource-guard.js';
export const resourceGuardStrategy = {
    name: 'resource-guard',
    evaluate({ raw, normalized, argsStr }, deps) {
        const decision = evaluateResourceGuard(normalized, argsStr, raw.arguments ?? undefined);
        if (!decision)
            return null;
        return { ...decision, action: deps.resolveAction(decision.action) };
    },
};
//# sourceMappingURL=resource-guard-strategy.js.map