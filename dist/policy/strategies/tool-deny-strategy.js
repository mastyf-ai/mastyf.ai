/** Enforce YAML tools.deny before semantic guards so tool blocks take precedence. */
export const toolDenyStrategy = {
    name: 'tool-deny',
    evaluate({ normalized }, deps) {
        for (const rule of deps.rules) {
            if (rule.enabled === false)
                continue;
            if (rule.tools?.deny?.includes(normalized.toolName)) {
                return {
                    action: deps.resolveAction(rule.action),
                    rule: rule.name,
                    reason: `Tool '${normalized.toolName}' is explicitly denied`,
                };
            }
        }
        return null;
    },
};
//# sourceMappingURL=tool-deny-strategy.js.map