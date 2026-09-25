import { scanToolDefinition, toolDefinitionIsMalicious, } from '../../scanners/tool-definition-scanner.js';
/** Scan tool metadata embedded in arguments (description / inputSchema). */
export const toolDefinitionStrategy = {
    name: 'tool-definition',
    evaluate({ normalized }, deps) {
        const args = normalized.arguments ?? {};
        const hasMeta = typeof args.description === 'string' ||
            args.inputSchema != null ||
            typeof args._tool_name === 'string';
        if (!hasMeta)
            return null;
        const tool = {
            name: String(args._tool_name ?? normalized.toolName),
            description: typeof args.description === 'string' ? args.description : undefined,
            inputSchema: args.inputSchema,
        };
        if (!toolDefinitionIsMalicious(tool))
            return null;
        const top = scanToolDefinition(tool).sort((a, b) => {
            const rank = { critical: 0, high: 1, medium: 2 };
            return rank[a.severity] - rank[b.severity];
        })[0];
        return {
            action: deps.resolveAction('block'),
            rule: 'tool-definition-scan',
            reason: `Malicious tool definition: ${top?.patternId ?? 'injection'} (${top?.severity ?? 'high'})`,
        };
    },
};
//# sourceMappingURL=tool-definition-strategy.js.map