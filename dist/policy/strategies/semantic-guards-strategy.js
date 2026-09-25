import { deobfuscateRecursive } from '../../utils/payload-normalizer.js';
import { walkStringLeaves } from '../arg-leaf-walker.js';
import { evaluateSemanticGuards } from '../semantic-guards.js';
import { evaluateToolChainGuard } from '../tool-chain-guard.js';
function evaluateSemanticShell(shellRisk, toolName, shellInput, deps) {
    if (deps.config.policy.semantic_shell === false)
        return null;
    const { shellTokenizer, resolveAction } = deps;
    const wsReason = shellTokenizer.detectWhitespaceObfuscatedShell(shellInput);
    if (wsReason) {
        return {
            action: resolveAction('block'),
            rule: 'semantic-shell-guard',
            reason: wsReason,
        };
    }
    const ncReason = shellTokenizer.detectNetcatReverseShell(shellInput);
    if (ncReason) {
        return {
            action: resolveAction('block'),
            rule: 'semantic-shell-guard',
            reason: ncReason,
        };
    }
    const psReason = shellTokenizer.detectPowerShellRisk(shellInput);
    if (psReason) {
        return {
            action: resolveAction('block'),
            rule: 'semantic-shell-guard',
            reason: psReason,
        };
    }
    const b64ShellReason = shellTokenizer.detectBase64PipeShell(shellInput);
    if (b64ShellReason) {
        return {
            action: resolveAction('block'),
            rule: 'semantic-shell-guard',
            reason: b64ShellReason,
        };
    }
    const substReason = shellTokenizer.detectSensitiveCommandSubstitution(shellInput);
    if (substReason) {
        return {
            action: resolveAction('block'),
            rule: 'semantic-shell-guard',
            reason: substReason,
        };
    }
    if (shellRisk.hasCommandSubstitution) {
        return {
            action: resolveAction('block'),
            rule: 'semantic-shell-guard',
            reason: 'Semantic: shell command substitution detected in arguments',
        };
    }
    if (shellRisk.dangerousCommands.length > 0) {
        return {
            action: resolveAction('block'),
            rule: 'semantic-shell-guard',
            reason: `Semantic: dangerous shell commands detected: [${shellRisk.dangerousCommands.join(', ')}]`,
        };
    }
    if (shellRisk.hasPipes && shellRisk.hasCommandSubstitution) {
        return {
            action: resolveAction('block'),
            rule: 'semantic-shell-guard',
            reason: 'Semantic: pipe chain with command substitution',
        };
    }
    void toolName;
    return null;
}
export const semanticGuardsStrategy = {
    name: 'semantic-guards',
    evaluate({ raw, normalized, argsStr }, deps) {
        const leafBlob = walkStringLeaves(normalized.arguments ?? {})
            .map((l) => deobfuscateRecursive(l.value))
            .join('\n');
        const shellInput = leafBlob.length > 0 ? leafBlob : argsStr;
        const shellRisk = shellInput.length > 0
            ? deps.shellTokenizer.analyzeRisk(deps.shellTokenizer.tokenize(shellInput).commands)
            : {
                hasCommandSubstitution: false,
                hasPipes: false,
                hasRedirects: false,
                hasLogicalChains: false,
                dangerousCommands: [],
                shellMetacharacters: [],
            };
        const shellDecision = evaluateSemanticShell(shellRisk, normalized.toolName, shellInput, deps);
        if (shellDecision)
            return shellDecision;
        const toolChain = evaluateToolChainGuard(normalized);
        if (toolChain) {
            return { ...toolChain, action: deps.resolveAction(toolChain.action) };
        }
        const semanticAbuse = evaluateSemanticGuards(normalized, raw.arguments ?? undefined);
        if (semanticAbuse) {
            return { ...semanticAbuse, action: deps.resolveAction(semanticAbuse.action) };
        }
        return null;
    },
};
//# sourceMappingURL=semantic-guards-strategy.js.map