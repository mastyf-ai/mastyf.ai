/**
 * Reads a POST /api/policy/test body. The dashboard sends `arguments` and `mode`; the
 * OpenAI Agents and LangChain middlewares (until this was fixed) sent `args` and
 * `blockingMode`, which were ignored, so every middleware check ran with empty arguments.
 * Both spellings are accepted.
 */
export function policyTestRequest(body, defaultPolicyPath) {
    const args = body.arguments ?? body.args ?? {};
    const mode = body.mode ?? body.blockingMode;
    return {
        policy: String(body.policyPath || defaultPolicyPath),
        tool: String(body.tool || 'unknown'),
        args: JSON.stringify(args && typeof args === 'object' ? args : {}),
        server: String(body.server || 'dashboard-test'),
        blockingMode: mode ? String(mode) : undefined,
        dryRun: body.dryRun === true,
        result: typeof body.result === 'string' ? body.result.slice(0, 64_000) : undefined,
    };
}
//# sourceMappingURL=policy-test-request.js.map