import { isFpWhitelisted } from '../../ai/fp-whitelist.js';
import { scanToolCallArguments } from '../../scanners/prompt-injection-detector.js';
export const requestPromptInjectionStrategy = {
    name: 'request-prompt-injection',
    evaluate({ normalized }, deps) {
        const piFindings = scanToolCallArguments(normalized.arguments ?? {});
        if (piFindings.length === 0)
            return null;
        const top = piFindings.sort((a, b) => {
            const rank = { critical: 0, high: 1, medium: 2 };
            return rank[a.severity] - rank[b.severity];
        })[0];
        const rule = 'request-prompt-injection';
        if (isFpWhitelisted(rule, top.patternId))
            return null;
        return {
            action: deps.resolveAction('block'),
            rule,
            reason: `Prompt injection in tool arguments: ${top.patternId} (${top.severity})`,
        };
    },
};
//# sourceMappingURL=request-prompt-injection-strategy.js.map