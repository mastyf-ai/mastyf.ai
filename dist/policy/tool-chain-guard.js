/**
 * Cross-tool chain guard — detects staged read-then-exfil instructions in argument text.
 * Complements regex prompt-injection rules when exfil uses post/webhook instead of curl.
 */
import { deobfuscateRecursive } from '../utils/payload-normalizer.js';
import { walkStringLeaves } from './arg-leaf-walker.js';
const READ_TOOLS = /\b(?:read_file|read|cat|head|tail|less|strings|type|get_file|fetch_file)\b/i;
const SENSITIVE_TARGETS = /(?:^|[\s'"`])(?:\/etc\/passwd|\.env(?:\.\w+)?|\.ssh\/|id_rsa|id_ed25519|\.aws\/|credentials|secrets?|serviceaccount\/token|terraform\.tfstate|\.kube\/config)\b/i;
const EXFIL_VERBS = /\b(?:curl|wget|fetch|ncat|netcat|post|send|upload|forward|deliver|transmit|ship|emit|exfil|webhook|callback)\b/i;
const CHAIN_CONNECTORS = /\b(?:then|after that|afterwards|next|finally|and then|step\s*2)\b/i;
/** Multi-step natural-language tool chaining (read sensitive data → exfil). */
const STAGED_CHAIN_RE = new RegExp(`${READ_TOOLS.source}.{0,120}${SENSITIVE_TARGETS.source}.{0,160}${CHAIN_CONNECTORS.source}.{0,120}${EXFIL_VERBS.source}`, 'i');
/** Inverse order: exfil instruction referencing prior read of secrets. */
const EXFIL_AFTER_READ_RE = new RegExp(`${EXFIL_VERBS.source}.{0,80}${SENSITIVE_TARGETS.source}|${SENSITIVE_TARGETS.source}.{0,120}${EXFIL_VERBS.source}`, 'i');
/** Step-labeled chains: "Step 1: read_file … Step 2: post …" */
const STEP_CHAIN_RE = /step\s*[12]\s*[:.]?\s*(?:read|cat|get).{0,200}step\s*[23]\s*[:.]?\s*(?:curl|post|send|wget|upload|webhook)/i;
/** Generic multi-step execution chains (analysis adv-cross-*). */
const EXECUTE_THEN_CHAIN_RE = /\bexecute\b.{0,200}\b(?:then|and then|next|after that|afterwards)\b/i;
/** Pre-invocation staging: call another tool before this one runs. */
const BEFORE_INVOKE_CHAIN_RE = /\bbefore\s+(?:invoking|calling|using)\s+(?:this\s+)?tool\b/i;
/** Privilege / admin tool invoked in argument text. */
const PRIVILEGED_TOOL_INVOKE_RE = /\b(?:call|invoke|run)\s+(?:authenticate_admin|elevate_privileges|sudo|admin_access)\b/i;
/** First-then natural language chains (MCPG cross-tool evasions). */
const FIRST_THEN_CHAIN_RE = /\bfirst\b.{0,120}\b(?:then|and then|next|afterwards)\b/i;
const MUST_INVOKE_RE = /\byou\s+must\s+(?:also\s+)?(?:call|invoke|run|execute)\b/i;
const THEN_EXECUTE_RE = /\b(?:then|and then|next|after that|afterwards)\b.{0,120}\bexecute\b/i;
const AFTER_THAT_RUN_RE = /\bafter\s+that\s+(?:call|invoke|run|execute)\b/i;
const ALWAYS_EXECUTE_RE = /\balways\s+(?:call|invoke|run|execute)\b/i;
/** Explicit call read_file → exfil staging (MCPG / upload-chain probes). */
const CALL_READ_EXFIL_RE = /\b(?:call|invoke|run)\s+(?:read_file|read)\b.{0,200}\b(?:then|and then|next|after that)\b.{0,160}\b(?:post|send|webhook|curl|wget|upload|exfil)\b/i;
/** Browser automation to localhost / admin surfaces. */
const PUPPETEER_LOCAL_ADMIN_RE = /\bpuppeteer_(?:navigate|screenshot)\b.{0,80}\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)\b/i;
export function evaluateToolChainGuard(ctx) {
    const args = ctx.arguments ?? {};
    const blob = walkStringLeaves(args)
        .map((l) => deobfuscateRecursive(l.value))
        .join('\n');
    if (!blob.trim())
        return null;
    if (STAGED_CHAIN_RE.test(blob) ||
        EXFIL_AFTER_READ_RE.test(blob) ||
        STEP_CHAIN_RE.test(blob) ||
        EXECUTE_THEN_CHAIN_RE.test(blob) ||
        BEFORE_INVOKE_CHAIN_RE.test(blob) ||
        PRIVILEGED_TOOL_INVOKE_RE.test(blob) ||
        FIRST_THEN_CHAIN_RE.test(blob) ||
        MUST_INVOKE_RE.test(blob) ||
        THEN_EXECUTE_RE.test(blob) ||
        AFTER_THAT_RUN_RE.test(blob) ||
        ALWAYS_EXECUTE_RE.test(blob) ||
        CALL_READ_EXFIL_RE.test(blob) ||
        PUPPETEER_LOCAL_ADMIN_RE.test(blob)) {
        return {
            action: 'block',
            rule: 'semantic-tool-chain-guard',
            reason: `Cross-tool exfiltration chain detected in '${ctx.toolName}' arguments`,
        };
    }
    return null;
}
//# sourceMappingURL=tool-chain-guard.js.map