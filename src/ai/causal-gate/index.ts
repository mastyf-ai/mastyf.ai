/**
 * Causal gate: stops a risky tool call when untrusted data the agent read appears to have caused it.
 * The secrecy side (secrets leaving through a sink) is the DIFC tracker in src/policy/difc.
 *
 * Off unless MASTYF_AI_CAUSAL_GATE is `shadow` (log only) or `enforce`. An internal error logs and
 * allows: this gate must never take the proxy down.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CallContext } from '../../policy/policy-types.js';
import { Logger } from '../../utils/logger.js';
import { CausalEngine, type PeerTaintLabel } from './engine.js';
import { FileTaintStore } from './memory-taint.js';
import type { SessionKey } from './ledger.js';

export type CausalGateMode = 'off' | 'shadow' | 'enforce';

export interface CausalGateBlock {
  block: true;
  rule: string;
  reason: string;
}

export interface CausalBlockEvent {
  tenantId?: string;
  sessionId?: string;
  serverName: string;
  toolName: string;
  rule: string;
  arguments?: Record<string, unknown>;
}

/** MCP `_meta` keys a framework can set on a tools/call. Both are optional. */
export const USER_REQUEST_META = 'mastyf/userRequest';
export const PEER_TAINT_META = 'mastyf/taint';

let engine: CausalEngine | null = null;
let errors = 0;
let blockListener: ((event: CausalBlockEvent) => void) | null = null;

function getEngine(): CausalEngine {
  engine ??= new CausalEngine({
    taintStore: new FileTaintStore(
      process.env['MASTYF_AI_CAUSAL_TAINT_PATH']?.trim() || join(homedir(), '.mastyf-ai', 'causal-taint.json'),
    ),
    peerSecret: process.env['MASTYF_AI_CAUSAL_PEER_SECRET']?.trim() || undefined,
  });
  return engine;
}

/** Called for each call the gate blocks, so fleet-level detectors see it. */
export function setCausalBlockListener(listener: ((event: CausalBlockEvent) => void) | null): void {
  blockListener = listener;
}

export function causalGateMode(): CausalGateMode {
  const mode = process.env['MASTYF_AI_CAUSAL_GATE']?.trim().toLowerCase();
  return mode === 'shadow' || mode === 'enforce' ? mode : 'off';
}

/**
 * By default values are followed within one session, or one server when the transport has no
 * session. `tenant` follows them across every server in the tenant, for a tenant running one agent.
 */
function sessionKey(tenantId: string | undefined, sessionId: string | undefined, serverName: string): SessionKey {
  if (process.env['MASTYF_AI_CAUSAL_GATE_SCOPE']?.trim().toLowerCase() === 'tenant') {
    return { tenantId, connectionId: 'tenant' };
  }
  return { tenantId, sessionId, connectionId: serverName };
}

function countError(where: string, err: unknown): void {
  errors++;
  Logger.warn(`[causal-gate] ${where} failed, allowing: ${err instanceof Error ? err.message : String(err)}`);
}

export function observeToolResult(input: {
  tenantId?: string;
  sessionId?: string;
  serverName: string;
  toolName: string;
  result: unknown;
}): void {
  if (causalGateMode() === 'off') return;
  try {
    getEngine().observe(sessionKey(input.tenantId, input.sessionId, input.serverName), input.serverName, input.toolName, input.result);
  } catch (err) {
    countError('observe', err);
  }
}

/** A server's tool descriptions and annotations, from tools/list on any transport. */
export function observeToolList(serverName: string, tools: readonly { name?: unknown; annotations?: unknown }[]): void {
  if (causalGateMode() === 'off') return;
  try {
    getEngine().observeToolList(serverName, tools);
  } catch (err) {
    countError('observe tools', err);
  }
}

/** The result of resources/read or prompts/get. */
export function observePublishedContent(method: string, result: unknown): void {
  if (causalGateMode() === 'off') return;
  try {
    getEngine().observePublished('server', method, result);
  } catch (err) {
    countError('observe published', err);
  }
}

/** Applies what a framework or a peer gateway attached to this tools/call. */
export function applyCausalMeta(context: CallContext, meta: Record<string, unknown> | undefined): void {
  if (!meta || causalGateMode() === 'off') return;
  try {
    const key = sessionKey(context.tenantId, context.sessionId, context.serverName);
    const request = meta[USER_REQUEST_META];
    if (typeof request === 'string') getEngine().trust(key, request);
    const label = meta[PEER_TAINT_META];
    if (label && !getEngine().importTaint(key, label as PeerTaintLabel)) {
      Logger.warn('[causal-gate] ignored a peer taint label that did not verify');
    }
  } catch (err) {
    countError('meta', err);
  }
}

/** The block to apply to this call, or null to let it continue. */
export function checkToolCall(context: CallContext): CausalGateBlock | null {
  const mode = causalGateMode();
  if (mode === 'off') return null;
  try {
    const key = sessionKey(context.tenantId, context.sessionId, context.serverName);
    const decision = getEngine().check(key, context.toolName, context.arguments ?? {}, { server: context.serverName });
    if (decision.action === 'allow') return null;
    if (mode === 'shadow') {
      Logger.info(`[causal-gate] shadow ${decision.action} ${decision.rule}: ${decision.message}`);
      return null;
    }
    blockListener?.({
      tenantId: context.tenantId,
      sessionId: context.sessionId,
      serverName: context.serverName,
      toolName: context.toolName,
      rule: decision.rule,
      arguments: context.arguments,
    });
    return { block: true, rule: decision.rule, reason: `Blocked by Mastyf causal gate: ${decision.message}` };
  } catch (err) {
    countError('check', err);
    return null;
  }
}

export function causalGateErrorCount(): number {
  return errors;
}

/** For tests. */
export function resetCausalGate(): void {
  engine = null;
  errors = 0;
  blockListener = null;
}
