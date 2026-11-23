/** What runPolicyTest needs (kept here so the request parsing loads without the policy engine). */
export interface PolicyTestOptions {
  policy: string;
  tool: string;
  args: string;
  server?: string;
  blockingMode?: string;
  /** What-if evaluation with no side effects (see CallContext.dryRun). */
  dryRun?: boolean;
  /**
   * When set, check this text as the tool's *result* (what the server sent back to the agent)
   * instead of checking a call. Same checks the proxy runs on every response.
   */
  result?: string;
}

/**
 * Reads a POST /api/policy/test body. The dashboard sends `arguments` and `mode`; the
 * OpenAI Agents and LangChain middlewares (until this was fixed) sent `args` and
 * `blockingMode`, which were ignored, so every middleware check ran with empty arguments.
 * Both spellings are accepted.
 */
export function policyTestRequest(
  body: Record<string, unknown>,
  defaultPolicyPath: string,
): PolicyTestOptions {
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
