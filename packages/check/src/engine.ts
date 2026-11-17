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
  /**
   * Include the words the check matched in a blocked result. Off by default: they are text an attacker
   * wrote, and a client that shows a verdict to the model would hand them straight back to it.
   */
  includeMatch?: boolean;
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
  /** Observe mode: allowed, but the free checks would have blocked it. */
  observed?: boolean;
}

export interface EngineOptions {
  policyPath?: string;
  mode?: 'block' | 'observe';
}

/** Set by the single-file build to the default policy's text; undefined elsewhere. */
declare const __CHECK_DEFAULT_POLICY__: string | undefined;

const DEFAULT_SERVER = 'agent';

type FingerprintState = { fingerprint: string | null; blocked: boolean };
const DEFAULT_TENANT = 'local';

/** Settings the local service needs before the pipeline modules load. */
function applyLocalServiceEnv(): void {
  // The 25 ms minimum evaluation time hides pass/block timing from callers of a hosted service; here
  // the caller is the agent on the same machine. (MASTYF_AI_POLICY_MIN_EVAL_MS=0 is ignored: the
  // reader treats 0 as unset and falls back to 25, so the envelope itself is switched off.)
  process.env['MASTYF_AI_POLICY_TIMING_ENVELOPE'] = 'false';
  process.env['MASTYF_AI_RESPONSE_DLP_MODE'] ??= 'redact';
  process.env['MASTYF_AI_AGENTIC_ENABLED'] = 'false';
  process.env['MASTYF_AI_LEARNING_MODE'] = 'false';
  // Regexes run inline: the worker-thread evaluator loads a separate file the single-file build doesn't carry.
  process.env['MASTYF_AI_REGEX_USE_WORKER'] = 'false';
  // Settings a shell may carry from other Mastyf tools that must not change the free service:
  // the LLM review is paid (its module is also stubbed), and results are always scanned.
  for (const name of ['MASTYF_AI_SEMANTIC_ASYNC', 'MASTYF_AI_SEMANTIC_SYNC_REQUEST', 'MASTYF_AI_SEMANTIC_SYNC_REQUEST_LLM', 'MASTYF_AI_SEMANTIC_STRICT']) {
    process.env[name] = 'false';
  }
  delete process.env['MASTYF_AI_SKIP_RESPONSE_SCAN'];
  // The pipeline logs every decision with the call's arguments at info level; the service logs its own, without them.
  process.env['LOG_LEVEL'] ??= 'error';
}

/** The argument a matched text came from: its name, or a dotted path into nested arguments. */
export function fieldFor(match: string | undefined, value: unknown, prefix = ''): string | undefined {
  if (!match) return undefined;
  if (typeof value === 'string') return value.includes(match) ? prefix || undefined : undefined;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = fieldFor(match, value[i], `${prefix}[${i}]`);
      if (hit) return hit;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      const hit = fieldFor(match, inner, prefix ? `${prefix}.${key}` : key);
      if (hit) return hit;
    }
  }
  return undefined;
}

function defaultPolicyPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', 'check-default-policy.yaml');
}

type Pipeline = {
  evaluateToolCallDefense: (input: any, deps: any) => Promise<any>;
  inspectToolResponse: (params: any) => Promise<any>;
  PolicyEngine: new (config: any) => any;
  applyToolFingerprint: (state: FingerprintState, tools: ToolDef[], ctx: Record<string, unknown>) => boolean;
};

const fingerprintKey = (server?: string, session?: string) => `${session ?? 'default'}|${server ?? DEFAULT_SERVER}`;

async function loadPipeline(): Promise<Pipeline> {
  const [orchestrator, inspection, engineMod, fingerprint] = await Promise.all([
    import('../../../src/proxy/tool-call-defense-orchestrator.js'),
    import('../../../src/proxy/response-inspection.js'),
    import('../../../src/policy/policy-engine.js'),
    import('../../../src/proxy/tool-fingerprint.js'),
  ]);
  return {
    evaluateToolCallDefense: orchestrator.evaluateToolCallDefense as Pipeline['evaluateToolCallDefense'],
    inspectToolResponse: inspection.inspectToolResponse as Pipeline['inspectToolResponse'],
    PolicyEngine: engineMod.PolicyEngine as unknown as Pipeline['PolicyEngine'],
    applyToolFingerprint: fingerprint.applyToolFingerprint as unknown as Pipeline['applyToolFingerprint'],
  };
}

type Evidence = { layer?: string; match?: string; field?: string; confidence?: number };
type Detail = Evidence & { reason?: string; rule?: string };

/** Drops fields that were not recorded, so the JSON answer carries only what is known. */
function compact(d: Detail): Detail {
  return Object.fromEntries(Object.entries(d).filter(([, value]) => value !== undefined && value !== '')) as Detail;
}

const LAYER_FOR_PHASE: Record<string, string> = {
  lifecycle: 'lifecycle',
  'pre-guard': 'policy',
  hooks: 'hooks',
  policy: 'policy',
  semantic: 'policy',
};

export class CheckEngine {
  /** One tool-definition fingerprint per session and server. */
  private readonly fingerprints = new Map<string, FingerprintState>();

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
    // The single-file build embeds the default policy; tests and the npm package read the file.
    const text = opts.policyPath
      ? readFileSync(opts.policyPath, 'utf8')
      : typeof __CHECK_DEFAULT_POLICY__ === 'string'
        ? __CHECK_DEFAULT_POLICY__
        : readFileSync(defaultPolicyPath(), 'utf8');
    const raw = load(text);
    const config = parsePolicyConfig(raw);
    const policyEngine = new pipeline.PolicyEngine(config);
    return new CheckEngine(pipeline, policyEngine, opts.mode ?? 'block', config.policy.rules.length);
  }

  ruleCount(): number {
    return this.rules;
  }

  /**
   * What a server offers. The first registration is remembered; a later one that changes a tool's
   * name, description or schema marks the server as changed, and its calls are blocked from then on.
   * Returns the block verdict when that happens, otherwise null.
   */
  registerTools(server: string, tools: ToolDef[], session?: string): Verdict | null {
    const key = fingerprintKey(server, session);
    const state = this.fingerprints.get(key) ?? { fingerprint: null, blocked: false };
    this.fingerprints.set(key, state);
    const changed = this.pipeline.applyToolFingerprint(state, tools, { serverName: server, tenantId: DEFAULT_TENANT, quiet: true });
    if (!changed) return null;
    return this.blocked(randomUUID(), {
      reason: `Server ${server} changed its tool definitions after they were registered`,
      rule: 'tool-fingerprint-mismatch',
      layer: 'lifecycle',
    });
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
        // The session history (chains, loops) is keyed by identity: one agent run, one history.
        agentIdentity: { sub: `${input.agent ?? 'agent'}:${input.session ?? 'default'}` },
      },
      {
        policyEngine: this.policyEngine,
        emitBlockTelemetry: false,
        rugPullState: this.fingerprints.get(fingerprintKey(input.server, input.session)),
      },
    );
    if (!outcome || typeof outcome.allowed !== 'boolean') throw new Error('malformed decision');
    if (outcome.allowed) return { decision: 'allow', id };
    const ev = outcome.evidence as Evidence | undefined;
    return this.blocked(id, {
      reason: outcome.reason,
      rule: outcome.rule,
      layer: ev?.layer ?? LAYER_FOR_PHASE[outcome.phase] ?? 'policy',
      match: ev?.match,
      field: ev?.field ?? fieldFor(ev?.match, input.arguments),
      confidence: ev?.confidence,
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
      const ev = outcome.evidence as Evidence | undefined;
      return this.blocked(id, {
        reason: error?.message ?? 'Blocked',
        rule: error?.data?.rule,
        layer: ev?.layer ?? 'answer-check',
        match: ev?.match,
        field: ev?.field,
        confidence: ev?.confidence,
        ...(input.includeMatch ? {} : { match: undefined }),
      });
    }
    if (outcome.redacted) {
      return { decision: 'redact', id, reason: (outcome.redactionReasons ?? []).join('; ') || 'Redacted', result: response['result'] };
    }
    return { decision: 'allow', id };
  }

  private blocked(id: string, v: Detail): Verdict {
    const detail = compact(v);
    if (this.mode === 'observe') {
      return { ...detail, decision: 'allow', id, observed: true, reason: `Would have blocked: ${v.reason ?? v.rule ?? 'blocked'}` };
    }
    return { ...detail, decision: 'block', id };
  }
}
