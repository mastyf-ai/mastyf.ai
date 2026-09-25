import { evaluateLanguageGadgetGuard } from '../language-gadget-guard.js';
export const languageGadgetStrategy = {
    name: 'language-gadget',
    evaluate({ normalized }, deps) {
        const decision = evaluateLanguageGadgetGuard(normalized);
        if (!decision)
            return null;
        return { ...decision, action: deps.resolveAction(decision.action) };
    },
};
//# sourceMappingURL=language-gadget-strategy.js.map