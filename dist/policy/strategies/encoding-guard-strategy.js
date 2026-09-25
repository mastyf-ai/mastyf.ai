import { evaluateEncodingGuard } from '../encoding-guard.js';
export const encodingGuardStrategy = {
    name: 'encoding-guard',
    evaluate({ raw }, deps) {
        const decision = evaluateEncodingGuard(raw);
        if (!decision)
            return null;
        return { ...decision, action: deps.resolveAction(decision.action) };
    },
};
//# sourceMappingURL=encoding-guard-strategy.js.map