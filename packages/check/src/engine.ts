/**
 * The free check engine: Mastyf's free rules, run on one tool call or one tool result at a time.
 * It wraps the same pipeline the proxy uses (evaluateToolCallDefense, inspectToolResponse) and never
 * says "allow" because of an error of its own.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CallInput {
  tool: string;
  arguments: Record<string, unknown>;
  server?: string;
  agent?: string;
  session?: string;
}

export interface ResultInput {
  tool: string;
  result: unknown;
  server?: string;
  agent?: string;
  session?: string;
  arguments?: Record<string, unknown>;
}

export interface ToolDef {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface Verdict {
  decision: 'allow' | 'block' | 'redact';
  reason?: string;
  layer?: string;
  rule?: string;
  match?: string;
  field?: string;
  confidence?: number;
  id: string;
  result?: unknown;
}

export interface EngineOptions {
  policyPath?: string;
  mode?: 'block' | 'observe';
}

const DEFAULT_SERVER = 'agent';
const DEFAULT_TENANT = 'local';

/** Settings the local service needs before the pipeline modules load. */
function applyLocalServiceEnv(): void {
  process.env['MASTYF_AI_POLICY_MIN_EVAL_MS'] = '0'; // the 25 ms floor is a timing guard for hosted use
  process.env['MASTYF_AI_RESPONSE_DLP_MODE'] ??= 'redact';
  process.env['MASTYF_AI_AGENTIC_ENABLED'] = 'false';
  process.env['MASTYF_AI_LEARNING_MODE'] = 'false';
}

function defaultPolicyPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', 'check-default-policy.yaml');
}

type Pipeline = {
  evaluateToolCallDefense: (input: any, deps: any) => Promise<any>;
  inspectToolResponse: (params: any) => Promise<any>;
  PolicyEngine: new (config: any) => any;
};

async function loadPipeline(): Promise<Pipeline> {
  const [orchestrator, inspection, engineMod] = await Promise.all([
    import('../../../src/proxy/tool-call-defense-orchestrator.js'),
    import('../../../src/proxy/response-inspection.js'),
    import('../../../src/policy/policy-engine.js'),
  ]);
  return {
    evaluateToolCallDefense: orchestrator.evaluateToolCallDefense as Pipeline['evaluateToolCallDefense'],
    inspectToolResponse: inspection.inspectToolResponse as Pipeline['inspectToolResponse'],
    PolicyEngine: engineMod.PolicyEngine as unknown as Pipeline['PolicyEngine'],
  };
}

const LAYER_FOR_PHASE: Record<string, string> = {
  lifecycle: 'lifecycle',
  'pre-guard': 'policy',
  hooks: 'hooks',
  policy: 'policy',
  semantic: 'policy',
};

export class CheckEngine {
  private constructor(
    private readonly pipeline: Pipeline,
    private readonly policyEngine: any,
    private readonly mode: 'block' | 'observe',
    private readonly rules: number,
  ) {}

  static async create(opts: EngineOptions = {}): Promise<CheckEngine> {
    applyLocalServiceEnv();
    const pipeline = await loadPipeline();
    const [{ load }, { parsePolicyConfig }] = await Promise.all([
      import('js-yaml'),
      import('../../../src/policy/policy-schema.js'),
    ]);
    const path = opts.policyPath ?? defaultPolicyPath();
    const raw = load(readFileSync(path, 'utf8'));
    const config = parsePolicyConfig(raw);
    const policyEngine = new pipeline.PolicyEngine(config);
    return new CheckEngine(pipeline, policyEngine, opts.mode ?? 'block', config.policy.rules.length);
  }

  ruleCount(): number {
    return this.rules;
  }

  async checkCall(input: CallInput): Promise<Verdict> {
    const id = randomUUID();
    const outcome = await this.pipeline.evaluateToolCallDefense(
      {
        serverName: input.server ?? DEFAULT_SERVER,
        toolName: input.tool,
        arguments: input.arguments,
        requestId: id,
        requestTokens: 0,
        tenantId: DEFAULT_TENANT,
        agentId: input.agent,
        mcpSessionId: input.session,
      },
      { policyEngine: this.policyEngine, emitBlockTelemetry: false },
    );
    if (!outcome || typeof outcome.allowed !== 'boolean') throw new Error('malformed decision');
    if (outcome.allowed) return { decision: 'allow', id };
    return this.blocked(id, {
      reason: outcome.reason,
      rule: outcome.rule,
      layer: LAYER_FOR_PHASE[outcome.phase] ?? 'policy',
    });
  }

  async checkResult(input: ResultInput): Promise<Verdict> {
    const id = randomUUID();
    const response: Record<string, unknown> = { jsonrpc: '2.0', id, result: input.result };
    const outcome = await this.pipeline.inspectToolResponse({
      response,
      toolName: input.tool,
      serverName: input.server ?? DEFAULT_SERVER,
      requestId: id,
      tenantId: DEFAULT_TENANT,
      policyEngine: this.policyEngine,
      transportLabel: 'check-service',
      toolArguments: input.arguments,
      sessionId: input.session,
    });
    if (outcome.blocked) {
      const error = (outcome.blockResponse as { error?: { message?: string; data?: { rule?: string } } } | undefined)?.error;
      return this.blocked(id, { reason: error?.message ?? 'Blocked', rule: error?.data?.rule, layer: 'answer-check' });
    }
    if (outcome.redacted) {
      return { decision: 'redact', id, reason: (outcome.redactionReasons ?? []).join('; ') || 'Redacted', result: response['result'] };
    }
    return { decision: 'allow', id };
  }

  private blocked(id: string, v: { reason?: string; rule?: string; layer?: string }): Verdict {
    if (this.mode === 'observe') {
      return { decision: 'allow', id, reason: `Would have blocked: ${v.reason ?? v.rule ?? 'blocked'}`, rule: v.rule, layer: v.layer };
    }
    return { decision: 'block', id, reason: v.reason, rule: v.rule, layer: v.layer };
  }
}
