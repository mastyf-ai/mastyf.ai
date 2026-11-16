/**
 * Cross-tool session chain detector — runtime graph over session flow with multi-step attack patterns.
 */
import { createHash } from 'crypto';
import type { CallContext, PolicyDecision } from './policy-types.js';
import { snapshotAuditArguments } from '../utils/audit-args-snapshot.js';
import {
  appendFlowEventSync,
  getFlowHistorySync,
  type FlowEvent,
} from './session-flow-store.js';
import { flowSessionKey } from './session-flow-guard.js';
import { walkStringLeaves } from './arg-leaf-walker.js';
import { classifyEgress } from './egress-classifier.js';

export type ChainGraphNode = {
  toolName: string;
  at: number;
  argShapeHash?: string;
  sensitiveRead: boolean;
  encodeHint: boolean;
  exfilHint: boolean;
};

export type ChainGraphEdge = {
  from: number;
  to: number;
  kind: 'temporal' | 'similarity';
};

export type SessionChainGraph = {
  sessionKey: string;
  nodes: ChainGraphNode[];
  edges: ChainGraphEdge[];
};

const READ_TOOLS = new Set([
  'read_file',
  'read_text_file',
  'read',
  'get_file_contents',
  'list_directory',
  'list_files',
  'search_files',
]);

const ENCODE_TOOLS = new Set([
  'run',
  'execute_command',
  'bash',
  'eval',
  'exec',
  'python',
  'node',
]);

const SAFE_EXFIL_DOMAINS = new Set([
  'localhost', '127.0.0.1',
  'example.com', 'httpbin.org', 'jsonplaceholder.typicode.com',
  'github.com', 'api.github.com', 'raw.githubusercontent.com',
  'npmjs.com', 'registry.npmjs.org', 'registry.yarnpkg.com',
  'googleapis.com', 'google.com',
  'docs.python.org', 'developer.mozilla.org', 'stackoverflow.com',
  'ollama.com', '127.0.0.1:11434',
]);

const EXFIL_TOOLS = new Set([
  'http_request',
  'post_webhook',
  'send_message',
  'notify',
  'upload',
  'send_email',
  'fetch',
  'curl',
]);

const ENCODE_ARG_HINTS = /\b(?:base64|btoa|encode|hex|rot13|gzip|compress)\b/i;
const EXFIL_ARG_HINTS = /\b(?:webhook|callback|post|upload|send|forward|https?:\/\/)\b/i;
const SENSITIVE_ARG_HINTS =
  /\b(?:\/etc\/passwd|\.env|\.ssh|id_rsa|credentials|secret|token|api[_-]?key)\b/i;

function isSafeExfilUrl(text: string): boolean {
  try {
    const urls = text.match(/https?:\/\/[^\s"'<>,;]+/g) || [];
    return urls.length > 0 && urls.every(u => {
      try { return SAFE_EXFIL_DOMAINS.has(new URL(u).hostname); } catch { return false; }
    });
  } catch { return false; }
}

function argShapeHash(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;
  const keys = Object.keys(args).sort();
  const shape = keys.map((k) => {
    const v = args[k];
    const t = Array.isArray(v) ? 'array' : typeof v;
    return `${k}:${t}`;
  });
  return createHash('sha256').update(shape.join('|')).digest('hex').slice(0, 12);
}

function argsBlob(args: Record<string, unknown> | undefined): string {
  if (!args) return '';
  return walkStringLeaves(args)
    .map((l) => l.value)
    .join('\n');
}

function classifyNode(
  toolName: string,
  args: Record<string, unknown> | undefined,
  strictEgress = false,
): Omit<ChainGraphNode, 'at'> {
  const lower = toolName.toLowerCase();
  const blob = argsBlob(args);
  // Argument words like "send"/"post" only count as egress when there is a destination URL.
  const argEgressHint = EXFIL_ARG_HINTS.test(blob) && /https?:\/\//i.test(blob);
  const rawExfil = EXFIL_TOOLS.has(lower) || EXFIL_ARG_HINTS.test(lower) || argEgressHint;
  // A bounded GET to a well-known read-only host is not exfiltration.
  const safeRead = rawExfil && classifyEgress(toolName, args, { strict: strictEgress }) === 'safe-read';
  return {
    toolName,
    argShapeHash: argShapeHash(args),
    sensitiveRead: READ_TOOLS.has(lower) && SENSITIVE_ARG_HINTS.test(blob),
    // A shell or interpreter tool only counts as an encoding step when its arguments encode
    // something, or when it ran with no arguments recorded. Treating every `bash` call as encoding
    // made any message sent after `git status` look like encode-then-exfil.
    encodeHint:
      ENCODE_ARG_HINTS.test(blob) ||
      ENCODE_ARG_HINTS.test(lower) ||
      (ENCODE_TOOLS.has(lower) && !blob.trim()),
    exfilHint: rawExfil && !safeRead && !isSafeExfilUrl(blob) && !isSafeExfilUrl(lower),
  };
}

export function buildSessionChainGraph(sessionKey: string, flow?: FlowEvent[]): SessionChainGraph {
  const events = flow ?? getFlowHistorySync(sessionKey);
  const nodes: ChainGraphNode[] = events.map((e) => {
    if (e.argumentsSnapshot && Object.keys(e.argumentsSnapshot).length) {
      const classified = classifyNode(e.toolName, e.argumentsSnapshot);
      return {
        toolName: e.toolName,
        at: e.at,
        argShapeHash: classified.argShapeHash,
        sensitiveRead: classified.sensitiveRead || e.sensitiveRead,
        encodeHint: classified.encodeHint,
        exfilHint: classified.exfilHint,
      };
    }
    return {
      toolName: e.toolName,
      at: e.at,
      sensitiveRead: e.sensitiveRead,
      encodeHint: ENCODE_ARG_HINTS.test(e.toolName),
      exfilHint: EXFIL_ARG_HINTS.test(e.toolName),
    };
  });

  const edges: ChainGraphEdge[] = [];
  for (let i = 1; i < nodes.length; i++) {
    edges.push({ from: i - 1, to: i, kind: 'temporal' });
    if (nodes[i - 1].argShapeHash && nodes[i].argShapeHash === nodes[i - 1].argShapeHash) {
      edges.push({ from: i - 1, to: i, kind: 'similarity' });
    }
  }

  return { sessionKey, nodes, edges };
}

export type ChainPatternMatch = {
  pattern: 'read-encode-exfil' | 'read-then-exfil' | 'encode-then-exfil' | 'multi-step-staging';
  nodes: number[];
  confidence: number;
};

export function detectChainPatterns(graph: SessionChainGraph): ChainPatternMatch[] {
  const { nodes } = graph;
  const matches: ChainPatternMatch[] = [];
  if (nodes.length < 2) return matches;

  for (let i = 0; i < nodes.length - 1; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const slice = nodes.slice(i, j + 1);
      // Only count confirmed sensitive reads — treating every list/read tool as "read"
      // causes multi-step-staging false positives when benign calls follow attack traffic.
      const hasRead = slice.some((n) => n.sensitiveRead);
      const hasEncode = slice.some((n) => n.encodeHint);
      const hasExfil = slice.some((n) => n.exfilHint);

      if (hasRead && hasEncode && hasExfil) {
        matches.push({
          pattern: 'read-encode-exfil',
          nodes: slice.map((_, idx) => i + idx),
          confidence: 0.9,
        });
      } else if (hasRead && hasExfil && !hasEncode) {
        matches.push({
          pattern: 'read-then-exfil',
          nodes: slice.map((_, idx) => i + idx),
          confidence: 0.85,
        });
      } else if (hasEncode && hasExfil) {
        matches.push({
          pattern: 'encode-then-exfil',
          nodes: slice.map((_, idx) => i + idx),
          confidence: 0.78,
        });
      } else if (slice.length >= 3 && hasRead && (hasEncode || hasExfil)) {
        matches.push({
          pattern: 'multi-step-staging',
          nodes: slice.map((_, idx) => i + idx),
          confidence: 0.65,
        });
      }
      // NOTE: a read-less "3+ calls with an egress hint" heuristic used to live here. Without a
      // confirmed sensitive read it flagged ordinary sessions (any 3rd call that sends something).
    }
  }

  const seen = new Set<string>();
  return matches.filter((m) => {
    const key = `${m.pattern}:${m.nodes.join('-')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Evaluate cross-tool chain patterns against current session history (no recording).
 *
 * Only the call being evaluated can trigger a block, and only when it is the egress step that
 * completes a chain. Earlier suspicious history never blocks later unrelated calls, so a session
 * recovers as soon as the agent moves on instead of staying blocked until the window expires.
 */
export function evaluateSessionChainGuard(ctx: CallContext): PolicyDecision | null {
  const key = flowSessionKey(ctx);
  const history = getFlowHistorySync(key);
  const anySensitive = history.some((e) => e.sensitiveRead);
  const node = classifyNode(ctx.toolName, ctx.arguments, anySensitive);
  // Nothing to complete: a call that is not an egress step cannot finish an exfil chain.
  if (!node.exfilHint) return null;

  const provisional: ChainGraphNode[] = [
    ...history.map((e) => {
      if (e.argumentsSnapshot && Object.keys(e.argumentsSnapshot).length) {
        const classified = classifyNode(e.toolName, e.argumentsSnapshot);
        return {
          toolName: e.toolName,
          at: e.at,
          argShapeHash: classified.argShapeHash,
          // Confirmed sensitive reads only; a plain read/list is not evidence of intent to steal.
          sensitiveRead: classified.sensitiveRead || e.sensitiveRead,
          encodeHint: classified.encodeHint,
          exfilHint: classified.exfilHint,
        };
      }
      return {
        toolName: e.toolName,
        at: e.at,
        sensitiveRead: e.sensitiveRead,
        encodeHint: ENCODE_ARG_HINTS.test(e.toolName),
        exfilHint: EXFIL_ARG_HINTS.test(e.toolName),
      };
    }),
    {
      toolName: ctx.toolName,
      at: Date.now(),
      argShapeHash: node.argShapeHash,
      sensitiveRead: node.sensitiveRead,
      encodeHint: node.encodeHint,
      exfilHint: node.exfilHint,
    },
  ];

  const graph: SessionChainGraph = {
    sessionKey: key,
    nodes: provisional,
    edges: [],
  };
  for (let i = 1; i < provisional.length; i++) {
    graph.edges.push({ from: i - 1, to: i, kind: 'temporal' });
  }

  const lastIdx = provisional.length - 1;
  const patterns = detectChainPatterns(graph).filter((p) => p.nodes[p.nodes.length - 1] === lastIdx);
  if (!patterns.length) return null;

  const best = patterns.sort((a, b) => b.confidence - a.confidence)[0];
  const toolPath = best.nodes.map((i) => graph.nodes[i]?.toolName).filter(Boolean).join(' → ');

  return {
    action: 'block',
    rule: 'session-chain-detector',
    reason: `Cross-tool chain (${best.pattern}): ${toolPath}`,
  };
}

export function recordSessionChainEvent(ctx: CallContext): void {
  const key = flowSessionKey(ctx);
  const node = classifyNode(ctx.toolName, ctx.arguments);
  appendFlowEventSync(key, {
    toolName: ctx.toolName,
    sensitiveRead: node.sensitiveRead,
    dataAccess: node.sensitiveRead || READ_TOOLS.has(ctx.toolName.toLowerCase()),
    at: Date.now(),
    argumentsSnapshot: snapshotAuditArguments(ctx.arguments),
  });
}
