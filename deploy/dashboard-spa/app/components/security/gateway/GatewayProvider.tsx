'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  escalationAllowAlwaysBody,
  escalationAllowOnceBody,
  escalationBlockBody,
  escalationBlockPermanentlyBody,
  gatewayErrorMessage,
} from '../../appliance/escalationGrant';

export interface GatewayStatusData {
  available: boolean;
  status?: string;
  control_api_version?: string;
  gateway_version?: string;
  contract_revision?: string;
  environment_state?: 'PROTECTED' | 'PARTIAL' | 'UNPROTECTED' | 'FAILED' | 'UNKNOWN';
  current_generation?: number;
  policy?: {
    id: string;
    version: string;
    hash: string;
    description: string;
  };
  servers_count?: number;
  ledger?: {
    chain_integrity: boolean;
    total_receipts: number;
    zero_byte_enforcements: number;
    allowed?: number;
    blocked?: number;
    escalated?: number;
  };
  intelligence?: {
    tier: string;
    name: string;
    guard_pro_active: boolean;
    entitlement: string;
    fallback_active: boolean;
    fallback_reason: string | null;
    aia_backend?: string;
    aia_engine?: string;
    aia_model?: string;
    advisory?: boolean;
    cannot_expand_authority?: boolean;
    latency_ms?: number | null;
    latency_p50_ms?: number | null;
    latency_p95_ms?: number | null;
    latency_p99_ms?: number | null;
    latency_source?: string | null;
    latency_samples?: number;
    cbac_latency_p50_ms?: number | null;
    difc_latency_p50_ms?: number | null;
    aia_latency_p50_ms?: number | null;
    decisions?: { ALLOW?: number; BLOCK?: number; ESCALATE?: number } | null;
    fast_path_percentage?: number | null;
    aia_evaluations?: number | null;
    aia_timeouts?: number | null;
    aia_malformed?: number | null;
    error_budget_threshold_ms?: number;
    error_budget_consuming?: boolean | null;
  };
  code?: string;
  message?: string;
}

/** How the dashboard is degraded when LIVE is false. */
export type GatewayDegradeKind = 'bff' | 'gateway' | null;

export interface ClientProtection {
  client?: string;
  client_name?: string;
  config_path?: string;
  exists?: boolean;
  total_servers: number;
  mediated_servers: number;
  unmediated_servers: number;
  unsupported_servers?: number;
  unmediated_names?: string[];
  status?: string;
}

export interface ProtectionReportData {
  result: 'PROTECTED' | 'PARTIAL' | 'UNPROTECTED' | 'FAILED' | 'UNKNOWN';
  status: string;
  clients: ClientProtection[];
  total_servers: number;
  total_mediated: number;
  total_unmediated: number;
  is_protected: boolean;
  summary: string;
}

export interface ClassifiedToolData {
  name: string;
  description: string;
  security_class: string;
  input_schema?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
}

export interface DiscoveredResourceData {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface DiscoveredServerData {
  name: string;
  client: string;
  command: string;
  args: string[];
  tools_count: number;
  tools: ClassifiedToolData[];
  /** Live resources/list when captured — never invented */
  resources?: DiscoveredResourceData[];
  resources_status?: string;
  /** stdio | sse | streamable-http | unknown — from unified registry / discovery */
  transport?: string;
  /** running | stopped | pending | unknown */
  status?: string;
  /** introspection_pending when tools[] empty after enrich */
  tools_status?: string;
  source?: string;
}

export interface PolicyData {
  /** Legacy / alternate shapes from BFF */
  active_hash?: string;
  policy_yaml?: string;
  valid?: boolean;
  rules_count?: number;
  warnings?: string[];
  /** Live control-plane /policy posture */
  policy_id?: string;
  policy_version?: string;
  policy_hash?: string;
  description?: string;
  allowed_read_count?: number;
  allowed_write_count?: number;
  workflow_gated_count?: number;
  blocked_count?: number;
  /** Live tool names from /policy — progressive disclosure (not invented) */
  allowed_read_tools?: string[];
  allowed_write_tools?: string[];
  workflow_gated_tools?: string[];
  blocked_tools?: string[];
  workflow_states?: string[];
  workflow_rules_count?: number;
  taint_rules_count?: number;
}

export interface ReceiptData {
  receipt_id: string;
  request_id?: string;
  sequence_id?: number;
  timestamp: string;
  timestamp_utc?: string;
  tool_name: string;
  server_name?: string;
  server_id?: string;
  client_name?: string;
  command_digest?: string;
  child_stdin_bytes?: number | null;
  decision: 'ALLOW' | 'BLOCK' | 'ESCALATE';
  enforcement_reason?: string;
  reason_code?: string;
  caller_agent: string;
  principal_id?: string;
  session_id?: string;
  payload_sha256: string;
  receipt_hash?: string;
  cbac_decision?: string;
  difc_decision?: string;
  aia_decision?: string;
  arbiter_decision?: string;
  workflow_decision?: string;
  workflow_rule?: string;
  backend_execution_count?: number;
  execution_observation?: string;
  response_firewall_decision?: string;
  response_firewall_action?: string;
  response_firewall_reason?: string;
  response_secrets_redacted_count?: number;
  policy_id?: string;
  policy_hash?: string;
  total_latency_ms?: number | null;
  aia_latency_ms?: number | null;
  cbac_latency_ms?: number | null;
  trace_id?: string;
}

export interface ServerStat {
  server_id: string;
  server_name: string;
  client_name?: string | null;
  command_digest?: string | null;
  total: number;
  allowed: number;
  blocked: number;
  escalated: number;
  zero_byte_enforcements: number;
  last_tool?: string | null;
  last_timestamp?: string | null;
  last_decision?: string | null;
}

export interface ControlReceiptData {
  receipt_id: string;
  timestamp: string;
  action: string;
  generation: number;
  policy_hash: string;
  plan_id: string | null;
  operator: string;
  signature: string;
}

export interface DecisionExplanationData {
  receipt_id: string;
  tool_name: string;
  server_name: string;
  decision: string;
  reason: string;
  rule_id: string | null;
  intelligence_assessment: {
    provider_tier: string;
    model_name: string;
    confidence: number;
    recommended_action: string;
    reason: string;
  } | null;
  explanation: string;
}

export interface DeploymentManifestData {
  model_id?: string;
  model_revision?: string;
  artifact?: string;
  sha256?: string;
  base_model?: string;
  runtime_commit?: string;
  format?: string;
  status?: string;
  verification_standard?: string;
  [key: string]: unknown;
}

export interface SelfTestCaseDetail {
  case_id: number;
  category: string;
  name: string;
  expected: string;
  actual: string;
  passed: boolean;
  backend_bytes?: number;
}

export interface SelfTestReport {
  status: string;
  passed?: boolean;
  total_cases: number;
  passed_cases: number;
  security_cases_passed?: number;
  security_cases_total?: number;
  difc_cases_passed?: number;
  difc_cases_total?: number;
  utility_cases_passed?: number;
  utility_cases_total?: number;
  auth_boundary_cases_passed?: number;
  auth_boundary_cases_total?: number;
  security_downgrades?: number;
  physical_dispatch_violations?: number;
  elapsed_ms?: number;
  details?: SelfTestCaseDetail[];
  failed_cases?: SelfTestCaseDetail[];
  manifest?: DeploymentManifestData;
  control_receipt?: Record<string, unknown>;
  [key: string]: unknown;
}

// Derived analytics types
export interface AgentStat {
  agent: string;
  total: number;
  allowed: number;
  blocked: number;
  escalated: number;
  blockRate: number;
}

export interface ToolStat {
  tool: string;
  total: number;
  blocked: number;
  escalated: number;
}

export interface SessionGroup {
  sessionId: string;
  receipts: ReceiptData[];
  allowed: number;
  blocked: number;
  escalated: number;
  firstTs: string;
  lastTs: string;
}

/** One ESCALATE receipt that has NOT yet been human-resolved (gateway-authoritative). */
export interface OpenEscalation {
  receipt_id: string;
  tool_name?: string | null;
  server_id?: string | null;
  server_name?: string | null;
  principal_id?: string | null;
  reason_code?: string | null;
  timestamp_utc?: string | null;
  resolution?: Record<string, unknown> | null;
}

interface GatewayContextType {
  status: GatewayStatusData | null;
  protection: ProtectionReportData | null;
  servers: DiscoveredServerData[];
  policy: PolicyData | null;
  receipts: ReceiptData[];
  controlReceipts: ControlReceiptData[];
  openEscalations: OpenEscalation[];
  openEscalationsLoaded: boolean;
  refreshEscalations: () => Promise<void>;
  agentStats: AgentStat[];
  toolStats: ToolStat[];
  sessionGroups: SessionGroup[];
  serverStats: ServerStat[];
  loading: boolean;
  error: string | null;
  degradeKind: GatewayDegradeKind;
  lastUpdated: number;
  streamConnected: boolean;
  refetch: () => Promise<void>;
  applyPlan: (plan: any, confirmation: boolean) => Promise<any>;
  rollback: (targetGeneration?: number, confirmation?: boolean) => Promise<any>;
  generatePlan: (serverNames?: string[]) => Promise<any>;
  proposePolicy: (intent: string) => Promise<any>;
  activatePolicy: (policyYaml: string, confirmation: boolean) => Promise<any>;
  explainDecision: (receiptId: string) => Promise<DecisionExplanationData>;
  allowEscalated: (receiptId: string) => Promise<any>;
  allowAlwaysEscalated: (receiptId: string) => Promise<any>;
  blockEscalated: (receiptId: string) => Promise<any>;
  blockPermanentlyEscalated: (receiptId: string) => Promise<any>;
  allowSimilarEscalated: (
    receiptId: string,
    opts?: {
      action?: string;
      ttlSeconds?: number;
      expiresAt?: number;
      remainingUses?: number;
      scopeDetails?: string;
      destination?: string;
      sessionId?: string;
    },
  ) => Promise<any>;
  runSelfTest: (opts?: { forceFailCaseId?: number }) => Promise<SelfTestReport>;
  getDeploymentManifest: () => Promise<DeploymentManifestData>;
  askChat: (
    question: string,
    history?: Array<{ role: string; content: string }>,
    contextEvent?: any,
    evidence?: string
  ) => Promise<{ answer: string; model?: string; grounding: any }>;
  agentChat: (opts: {
    message: string;
    sessionId?: string;
    principalId?: string;
    mock?: boolean;
  }) => Promise<{
    session_id: string;
    reply: string;
    tool_events: Array<{
      tool_name: string;
      tool_args: Record<string, unknown>;
      decision: string;
      reason_code: string;
      rule_violated: string | null;
      bytes_dispatched: number;
      receipt_hash: string | null;
      latency_ms: number | null;
      execution_certainty: string;
    }>;
    model_name: string;
  }>;
}

const GatewayContext = createContext<GatewayContextType | null>(null);

const POLL_INTERVAL_MS = 6000;
// Full-ledger read: keep this an order of magnitude below POLL_INTERVAL_MS.
const ESCALATION_POLL_INTERVAL_MS = 30000;

// Fetch ALL receipts via high-capacity endpoint (up to 500 per call)
async function fetchAllReceipts(): Promise<ReceiptData[]> {
  try {
    const first = await fetch(`/api/gateway/receipts?limit=500&offset=0`);
    if (!first.ok) return [];
    const firstData = await first.json();
    const list: ReceiptData[] = firstData.receipts || [];
    const total: number = firstData.total_receipts ?? firstData.total ?? list.length;
    if (total > list.length && list.length > 0) {
      const nextRes = await fetch(`/api/gateway/receipts?limit=500&offset=${list.length}`);
      if (nextRes.ok) {
        const nextData = await nextRes.json();
        list.push(...(nextData.receipts || []));
      }
    }
    return list;
  } catch {
    return [];
  }
}

function deriveAgentStats(receipts: ReceiptData[]): AgentStat[] {
  const map = new Map<string, AgentStat>();
  for (const r of receipts) {
    const agent = r.caller_agent || r.principal_id || 'Unknown';
    if (!map.has(agent)) map.set(agent, { agent, total: 0, allowed: 0, blocked: 0, escalated: 0, blockRate: 0 });
    const s = map.get(agent)!;
    s.total++;
    const d = r.decision || (r as any).arbiter_decision || '';
    if (d === 'ALLOW') s.allowed++;
    else if (d === 'BLOCK') s.blocked++;
    else if (d === 'ESCALATE') s.escalated++;
  }
  for (const s of map.values()) {
    s.blockRate = s.total > 0 ? Math.round(((s.blocked + s.escalated) / s.total) * 100) : 0;
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

function deriveToolStats(receipts: ReceiptData[]): ToolStat[] {
  const map = new Map<string, ToolStat>();
  for (const r of receipts) {
    const tool = r.tool_name || 'unknown';
    if (!map.has(tool)) map.set(tool, { tool, total: 0, blocked: 0, escalated: 0 });
    const s = map.get(tool)!;
    s.total++;
    const d = r.decision || (r as any).arbiter_decision || '';
    if (d === 'BLOCK') s.blocked++;
    else if (d === 'ESCALATE') s.escalated++;
  }
  return Array.from(map.values()).sort((a, b) => (b.blocked + b.escalated) - (a.blocked + a.escalated));
}

function deriveSessionGroups(receipts: ReceiptData[]): SessionGroup[] {
  const map = new Map<string, SessionGroup>();
  for (const r of receipts) {
    const sid = r.session_id || 'unknown-session';
    if (!map.has(sid)) map.set(sid, { sessionId: sid, receipts: [], allowed: 0, blocked: 0, escalated: 0, firstTs: r.timestamp || r.timestamp_utc || '', lastTs: '' });
    const g = map.get(sid)!;
    g.receipts.push(r);
    g.lastTs = r.timestamp || r.timestamp_utc || '';
    const d = r.decision || (r as any).arbiter_decision || '';
    if (d === 'ALLOW') g.allowed++;
    else if (d === 'BLOCK') g.blocked++;
    else if (d === 'ESCALATE') g.escalated++;
  }
  return Array.from(map.values()).sort((a, b) => b.receipts.length - a.receipts.length);
}

function deriveServerStats(receipts: ReceiptData[]): ServerStat[] {
  const map = new Map<string, ServerStat>();
  for (const r of receipts) {
    const sid = r.server_id || r.server_name || 'mcp-server';
    if (!map.has(sid)) {
      map.set(sid, {
        server_id: sid,
        server_name: r.server_name || sid,
        client_name: r.client_name,
        command_digest: r.command_digest,
        total: 0,
        allowed: 0,
        blocked: 0,
        escalated: 0,
        zero_byte_enforcements: 0,
      });
    }
    const s = map.get(sid)!;
    s.total++;
    const d = r.decision || (r as any).arbiter_decision || '';
    if (d === 'ALLOW') s.allowed++;
    else if (d === 'BLOCK') {
      s.blocked++;
      s.zero_byte_enforcements++;
    } else if (d === 'ESCALATE') {
      s.escalated++;
      s.zero_byte_enforcements++;
    }
    s.last_tool = r.tool_name;
    s.last_timestamp = r.timestamp_utc || r.timestamp;
    s.last_decision = d;
    if (r.client_name && !s.client_name) s.client_name = r.client_name;
    if (r.command_digest && !s.command_digest) s.command_digest = r.command_digest;
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

export function GatewayProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<GatewayStatusData | null>(null);
  const [protection, setProtection] = useState<ProtectionReportData | null>(null);
  const [servers, setServers] = useState<DiscoveredServerData[]>([]);
  const [policy, setPolicy] = useState<PolicyData | null>(null);
  const [receipts, setReceipts] = useState<ReceiptData[]>([]);
  const [controlReceipts, setControlReceipts] = useState<ControlReceiptData[]>([]);
  const [openEscalations, setOpenEscalations] = useState<OpenEscalation[]>([]);
  const [openEscalationsLoaded, setOpenEscalationsLoaded] = useState(false);
  const [serverStatsRemote, setServerStatsRemote] = useState<ServerStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [degradeKind, setDegradeKind] = useState<GatewayDegradeKind>(null);
  const [lastUpdated, setLastUpdated] = useState(Date.now());
  const [streamConnected, setStreamConnected] = useState(false);
  const lastLedgerCountRef = useRef<number>(-1);
  const lastSeqRef = useRef<number>(0);

  const fetchAll = useCallback(async () => {
    try {
      const statusRes = await fetch('/api/gateway/status');
      if (statusRes.ok) {
        const rawText = await statusRes.text();
        let sData: GatewayStatusData;
        try {
          sData = JSON.parse(rawText) as GatewayStatusData;
        } catch {
          setError(
            'Dashboard gateway proxy returned non-JSON (HTTP 200 body was not JSON). Is the Node BFF running on :4000? Start: pnpm dashboard:proxy (or scripts/watch-dashboard-proxy.sh)',
          );
          setDegradeKind('bff');
          setStatus({ available: false });
          return;
        }
        setStatus((prev) => {
          if (!prev || !prev.ledger) return sData;
          const prevTotal = prev.ledger.total_receipts || 0;
          const nextTotal = sData.ledger?.total_receipts || 0;
          if (prevTotal > nextTotal && sData.ledger) {
            return {
              ...sData,
              ledger: {
                ...sData.ledger,
                chain_integrity: sData.ledger.chain_integrity ?? prev.ledger.chain_integrity ?? true,
                total_receipts: Math.max(prevTotal, nextTotal),
                blocked: Math.max(prev.ledger.blocked || 0, sData.ledger?.blocked || 0),
                allowed: Math.max(prev.ledger.allowed || 0, sData.ledger?.allowed || 0),
                escalated: Math.max(prev.ledger.escalated || 0, sData.ledger?.escalated || 0),
                zero_byte_enforcements: Math.max(prev.ledger.zero_byte_enforcements || 0, sData.ledger?.zero_byte_enforcements || 0),
              },
            };
          }
          return sData;
        });

        if (sData.available) {
          setError(null);
          setDegradeKind(null);
          const currentCount = sData.ledger?.total_receipts ?? 0;
          const shouldRefetchReceipts = currentCount !== lastLedgerCountRef.current;

          const tasks: Array<Promise<Response> | Promise<ReceiptData[]> | null> = [
            fetch('/api/gateway/protection'),
            fetch('/api/gateway/servers'),
            fetch('/api/gateway/policy'),
            fetch('/api/gateway/control-receipts?limit=100'),
            fetch('/api/gateway/servers/stats'),
            shouldRefetchReceipts ? fetchAllReceipts() : null,
          ];

          const settled = await Promise.allSettled(tasks.filter(Boolean) as Promise<unknown>[]);
          let ti = 0;
          const next = () => settled[ti++];

          const protRes = next();
          const srvRes = next();
          const polRes = next();
          const ctrlRes = next();
          const statsRes = next();
          const allReceipts = shouldRefetchReceipts ? next() : null;

          const safeJson = async (res: Response) => {
            const t = await res.text();
            try {
              return JSON.parse(t);
            } catch {
              return null;
            }
          };

          if (protRes?.status === 'fulfilled' && (protRes.value as Response)?.ok) {
            const data = await safeJson(protRes.value as Response);
            if (data) setProtection(data);
          }
          if (srvRes?.status === 'fulfilled' && (srvRes.value as Response)?.ok) {
            const raw = await safeJson(srvRes.value as Response);
            if (raw) setServers(Array.isArray(raw) ? raw : raw.servers || []);
          }
          if (polRes?.status === 'fulfilled' && (polRes.value as Response)?.ok) {
            const data = await safeJson(polRes.value as Response);
            if (data) setPolicy(data);
          }
          if (ctrlRes?.status === 'fulfilled' && (ctrlRes.value as Response)?.ok) {
            const data = await safeJson(ctrlRes.value as Response);
            if (data) setControlReceipts(data.receipts || data.control_receipts || []);
          }
          if (statsRes?.status === 'fulfilled' && (statsRes.value as Response)?.ok) {
            const data = await safeJson(statsRes.value as Response);
            if (data) setServerStatsRemote(Array.isArray(data.servers) ? data.servers : []);
          }
          if (allReceipts && allReceipts.status === 'fulfilled' && Array.isArray(allReceipts.value)) {
            setReceipts(allReceipts.value as ReceiptData[]);
            lastLedgerCountRef.current = currentCount;
          }
        } else {
          const msg = sData.message || 'Mastyf Gateway is offline';
          const isGw =
            sData.code === 'GATEWAY_STATE_UNAVAILABLE' ||
            /8443|Gateway at|control plane|fetch failed/i.test(msg);
          setError(
            isGw
              ? `${msg} — Start Gateway: cd mastyf_gateway && python3 -m mastyf_gateway.cli serve --port 8443`
              : msg,
          );
          setDegradeKind(isGw ? 'gateway' : 'bff');
        }
      } else {
        const bodyHint =
          statusRes.status === 500 || statusRes.status === 502 || statusRes.status === 503
            ? ' — Node BFF on :4000 is down or unreachable from Next (:3000 rewrite). Start: pnpm dashboard:proxy (durable: scripts/watch-dashboard-proxy.sh)'
            : '';
        setError(`Failed to reach dashboard gateway proxy (HTTP ${statusRes.status})${bodyHint}`);
        setDegradeKind('bff');
        setStatus({ available: false });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const nicer = /JSON\.parse|Unexpected token|unexpected character|Internal Server Error|<html/i.test(
        msg,
      )
        ? 'Dashboard gateway proxy returned non-JSON / HTML (BFF on :4000 likely down). Start: pnpm dashboard:proxy'
        : /Failed to fetch|NetworkError|ECONNREFUSED/i.test(msg)
          ? 'Cannot reach /api/gateway/* — Next rewrite to :4000 failed. Start Node BFF: pnpm dashboard:proxy'
          : msg;
      setError(`Gateway state unavailable: ${nicer}`);
      setDegradeKind('bff');
    } finally {
      setLoading(false);
      setLastUpdated(Date.now());
    }
  }, []);

  // Resolution-aware escalation queue. Deliberately kept OUT of fetchAll(): the
  // gateway endpoint replays the full receipt ledger, and fetchAll polls every
  // POLL_INTERVAL_MS, so folding it in would re-scan the ledger every 6s.
  const refreshEscalations = useCallback(async () => {
    try {
      const res = await fetch('/api/gateway/escalations?status=open');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Escalations failed (${res.status})`);
      setOpenEscalations(Array.isArray(body?.escalations) ? body.escalations : []);
      setOpenEscalationsLoaded(true);
    } catch {
      // Leave the last known set and `loaded` flag alone: a stale-but-known queue
      // is safer than an empty one, which would make resolved escalations
      // look actionable again.
    }
  }, []);

  useEffect(() => {
    void fetchAll();
    const interval = setInterval(() => {
      void fetchAll();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchAll, refreshEscalations]);

  useEffect(() => {
    void refreshEscalations();
  }, [refreshEscalations]);

  // Receipts poll every POLL_INTERVAL_MS but the open-escalation set is a
  // full-ledger read, so it gets a much slower cadence. Without this the set
  // would go stale and a genuinely NEW escalation would arrive in `receipts`,
  // miss the open set, and be mislabelled RESOLVED.
  useEffect(() => {
    const interval = setInterval(() => {
      void refreshEscalations();
    }, ESCALATION_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refreshEscalations]);

  // SSE live ledger — reconnect with backoff + after_sequence; poll remains fallback
  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = 1000;

    const attach = () => {
      if (closed) return;
      const seq = lastSeqRef.current > 0 ? lastSeqRef.current : 0;
      const url =
        seq > 0
          ? `/api/gateway/events/stream?after_sequence=${seq}`
          : '/api/gateway/events/stream';
      try {
        es = new EventSource(url);
      } catch {
        setStreamConnected(false);
        scheduleReconnect();
        return;
      }

      es.addEventListener('hello', () => {
        if (!closed) {
          setStreamConnected(true);
          backoffMs = 1000;
        }
      });
      es.addEventListener('ping', () => {
        if (!closed) {
          setStreamConnected(true);
          setLastUpdated(Date.now());
        }
      });
      es.addEventListener('receipt', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data);
          const r = data.receipt as ReceiptData;
          if (!r) return;
          const seqId = Number(data.sequence_id ?? r.sequence_id ?? 0);
          if (seqId > lastSeqRef.current) lastSeqRef.current = seqId;
          const isBlocked = r.decision === 'BLOCK' || (r as any).arbiter_decision === 'BLOCK';
          const isAllowed = r.decision === 'ALLOW' || (r as any).arbiter_decision === 'ALLOW';
          const isEscalated = r.decision === 'ESCALATE' || (r as any).arbiter_decision === 'ESCALATE';

          setReceipts((prev) => {
            const id = r.receipt_id || r.request_id;
            if (id && prev.some((x) => (x.receipt_id || x.request_id) === id)) return prev;
            const next = [r, ...prev];
            lastLedgerCountRef.current = next.length;
            return next;
          });

          setStatus((prev) => {
            if (!prev) return prev;
            const old = prev.ledger || {
              total_receipts: 0,
              allowed: 0,
              blocked: 0,
              escalated: 0,
              zero_byte_enforcements: 0,
              chain_integrity: true,
            };
            return {
              ...prev,
              ledger: {
                ...old,
                total_receipts: (old.total_receipts || 0) + 1,
                allowed: (old.allowed || 0) + (isAllowed ? 1 : 0),
                blocked: (old.blocked || 0) + (isBlocked ? 1 : 0),
                escalated: (old.escalated || 0) + (isEscalated ? 1 : 0),
                zero_byte_enforcements: (old.zero_byte_enforcements || 0) + (isBlocked ? 1 : 0),
              },
            };
          });

          setLastUpdated(Date.now());
        } catch {
          /* ignore malformed */
        }
      });
      es.addEventListener('control_receipt', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data);
          const r = data.receipt as ControlReceiptData;
          if (!r) return;
          setControlReceipts((prev) => {
            if (r.receipt_id && prev.some((x) => x.receipt_id === r.receipt_id)) return prev;
            return [r, ...prev].slice(0, 100);
          });
          setLastUpdated(Date.now());
        } catch {
          /* ignore */
        }
      });
      es.addEventListener('ledger', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data);
          const ls = Number(data.last_sequence ?? 0);
          if (ls > lastSeqRef.current) lastSeqRef.current = ls;
        } catch {
          /* ignore */
        }
        setLastUpdated(Date.now());
      });
      es.onerror = () => {
        setStreamConnected(false);
        es?.close();
        es = null;
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (closed || reconnectTimer) return;
      const wait = backoffMs;
      backoffMs = Math.min(backoffMs * 2, 15000);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        attach();
      }, wait);
    };

    attach();

    const handleCustomReceipt = (e: Event) => {
      try {
        const customEv = e as CustomEvent<{ receipt: ReceiptData }>;
        if (!customEv.detail || !customEv.detail.receipt) return;
        const r = customEv.detail.receipt;
        const isBlocked = r.decision === 'BLOCK' || (r as any).arbiter_decision === 'BLOCK';
        const isAllowed = r.decision === 'ALLOW' || (r as any).arbiter_decision === 'ALLOW';
        const isEscalated = r.decision === 'ESCALATE' || (r as any).arbiter_decision === 'ESCALATE';

        setReceipts((prev) => {
          const id = r.receipt_id || r.request_id;
          if (id && prev.some((x) => (x.receipt_id || x.request_id) === id)) return prev;
          const next = [r, ...prev];
          lastLedgerCountRef.current = next.length;
          return next;
        });

        setStatus((prev) => {
          if (!prev) return prev;
          const old = prev.ledger || {
            total_receipts: 0,
            allowed: 0,
            blocked: 0,
            escalated: 0,
            zero_byte_enforcements: 0,
            chain_integrity: true,
          };
          return {
            ...prev,
            ledger: {
              ...old,
              total_receipts: (old.total_receipts || 0) + 1,
              allowed: (old.allowed || 0) + (isAllowed ? 1 : 0),
              blocked: (old.blocked || 0) + (isBlocked ? 1 : 0),
              escalated: (old.escalated || 0) + (isEscalated ? 1 : 0),
              zero_byte_enforcements: (old.zero_byte_enforcements || 0) + (isBlocked ? 1 : 0),
            },
          };
        });

        setLastUpdated(Date.now());
      } catch {
        /* ignore */
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('mastyf:receipt', handleCustomReceipt);
      (window as any).mastyfEmitReceipt = (receipt: ReceiptData) => {
        window.dispatchEvent(new CustomEvent('mastyf:receipt', { detail: { receipt } }));
      };
    }

    return () => {
      closed = true;
      setStreamConnected(false);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
      if (typeof window !== 'undefined') {
        window.removeEventListener('mastyf:receipt', handleCustomReceipt);
      }
    };
  }, []);

  const agentStats = useMemo(() => deriveAgentStats(receipts), [receipts]);
  const toolStats = useMemo(() => deriveToolStats(receipts), [receipts]);
  const sessionGroups = useMemo(() => deriveSessionGroups(receipts), [receipts]);
  const serverStats = useMemo(
    () => (serverStatsRemote.length > 0 ? serverStatsRemote : deriveServerStats(receipts)),
    [serverStatsRemote, receipts],
  );

  const applyPlan = useCallback(async (plan: any, confirmation: boolean) => {
    const res = await fetch('/api/gateway/protection/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan, confirmation }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || `Apply failed (${res.status})`);
    await fetchAll();
    return result;
    await refreshEscalations();
  }, [fetchAll, refreshEscalations]);

  const rollback = useCallback(async (targetGeneration?: number, confirmation: boolean = false) => {
    const res = await fetch('/api/gateway/protection/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetGeneration, confirmation }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || `Rollback failed (${res.status})`);
    await fetchAll();
    return result;
    await refreshEscalations();
  }, [fetchAll, refreshEscalations]);

  const generatePlan = useCallback(async (serverNames?: string[]) => {
    const res = await fetch('/api/gateway/protection/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverNames }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || `Plan generation failed (${res.status})`);
    return result;
  }, []);

  const proposePolicy = useCallback(async (intent: string) => {
    const res = await fetch('/api/gateway/policy/propose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || `Policy propose failed (${res.status})`);
    return result;
  }, []);

  const activatePolicy = useCallback(async (policyYaml: string, confirmation: boolean) => {
    const res = await fetch('/api/gateway/policy/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ policyYaml, confirmation }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || `Policy activation failed (${res.status})`);
    await fetchAll();
    return result;
    await refreshEscalations();
  }, [fetchAll, refreshEscalations]);

  const explainDecision = useCallback(async (receiptId: string) => {
    const res = await fetch('/api/gateway/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiptId }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || `Explain decision failed (${res.status})`);
    return result as DecisionExplanationData;
  }, []);

  const allowEscalated = useCallback(async (receiptId: string) => {
    const res = await fetch('/api/gateway/escalation/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(escalationAllowOnceBody(receiptId)),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(gatewayErrorMessage(result, `Allow once failed (${res.status})`));
    }
    await fetchAll();
    return result;
    await refreshEscalations();
  }, [fetchAll, refreshEscalations]);

  const allowAlwaysEscalated = useCallback(async (receiptId: string) => {
    const res = await fetch('/api/gateway/escalation/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(escalationAllowAlwaysBody(receiptId)),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(gatewayErrorMessage(result, `Allow always failed (${res.status})`));
    }
    await fetchAll();
    return result;
    await refreshEscalations();
  }, [fetchAll, refreshEscalations]);

  const blockEscalated = useCallback(async (receiptId: string) => {
    const res = await fetch('/api/gateway/escalation/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...escalationBlockBody(receiptId),
      }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(gatewayErrorMessage(result, `Block failed (${res.status})`));
    }
    await fetchAll();
    return result;
    await refreshEscalations();
  }, [fetchAll, refreshEscalations]);

  const blockPermanentlyEscalated = useCallback(async (receiptId: string) => {
    const res = await fetch('/api/gateway/escalation/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(escalationBlockPermanentlyBody(receiptId)),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(gatewayErrorMessage(result, `Block permanently failed (${res.status})`));
    }
    await fetchAll();
    return result;
    await refreshEscalations();
  }, [fetchAll, refreshEscalations]);

  const allowSimilarEscalated = useCallback(async (
    receiptId: string,
    opts?: {
      action?: string;
      ttlSeconds?: number;
      expiresAt?: number;
      remainingUses?: number;
      scopeDetails?: string;
      destination?: string;
      sessionId?: string;
    },
  ) => {
    const res = await fetch('/api/gateway/escalation/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receipt_id: receiptId,
        action: opts?.action || 'similar',
        confirmation: true,
        ttl_seconds: opts?.ttlSeconds ?? 3600,
        expires_at: opts?.expiresAt,
        remaining_uses: opts?.remainingUses,
        scope_details: opts?.scopeDetails,
        destination: opts?.destination,
        session_id: opts?.sessionId,
      }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(gatewayErrorMessage(result, `Allow similar failed (${res.status})`));
    }
    await fetchAll();
    return result;
    await refreshEscalations();
  }, [fetchAll, refreshEscalations]);

  const runSelfTest = useCallback(async (opts?: { forceFailCaseId?: number }) => {
    const res = await fetch('/api/gateway/self-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        opts?.forceFailCaseId != null ? { force_fail_case_id: opts.forceFailCaseId } : {},
      ),
    });
    const raw = await res.text();
    let result: Record<string, unknown> = {};
    try {
      result = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      result = { error: raw.trim().slice(0, 240) || `Self-test failed (${res.status})` };
    }
    if (!res.ok) {
      const detail = [result.error, result.reason, result.detail]
        .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        .join(' — ');
      throw new Error(detail || `Self-test failed (${res.status})`);
    }
    await fetchAll();
    return result as SelfTestReport;
  }, [fetchAll, refreshEscalations]);

  const getDeploymentManifest = useCallback(async () => {
    const res = await fetch('/api/gateway/deployment-manifest');
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(result.error || result.detail || `Manifest fetch failed (${res.status})`);
    return result as DeploymentManifestData;
  }, []);

  const askChat = useCallback(
    async (
      question: string,
      history?: Array<{ role: string; content: string }>,
      contextEvent?: any,
      evidence?: string
    ) => {
      const res = await fetch('/api/gateway/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history, contextEvent, evidence }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || `Chat request failed (${res.status})`);
      return result;
    },
    []
  );

  const agentChat = useCallback(
    async (opts: {
      message: string;
      sessionId?: string;
      principalId?: string;
      mock?: boolean;
    }) => {
      const res = await fetch('/api/gateway/agent-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || `Agent chat request failed (${res.status})`);
      
      if (Array.isArray(result.tool_events) && result.tool_events.length > 0) {
        setReceipts((prev) => {
          const newItems: ReceiptData[] = result.tool_events.map((e: any) => ({
            receipt_id: e.receipt_hash || `rec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            decision: e.decision,
            tool_name: e.tool_name,
            reason_code: e.reason_code,
            bytes_dispatched: e.bytes_dispatched ?? 0,
            timestamp: new Date().toISOString(),
            agent: 'mcp-client',
          }));
          return [...newItems, ...(prev || [])];
        });
        setStatus((prev) => {
          if (!prev) return prev;
          const blockedCount = result.tool_events.filter((e: any) => e.decision !== 'ALLOW').length;
          const allowedCount = result.tool_events.filter((e: any) => e.decision === 'ALLOW').length;
          const prevLedger = prev.ledger || {
            total_receipts: 0,
            blocked: 0,
            allowed: 0,
            escalated: 0,
            zero_byte_enforcements: 0,
            chain_integrity: true,
          };
          return {
            ...prev,
            ledger: {
              ...prevLedger,
              total_receipts: (prevLedger.total_receipts || 0) + result.tool_events.length,
              blocked: (prevLedger.blocked || 0) + blockedCount,
              allowed: (prevLedger.allowed || 0) + allowedCount,
              zero_byte_enforcements: (prevLedger.zero_byte_enforcements || 0) + blockedCount,
            },
          };
        });
      }
      void fetchAll();
      return result;
    },
    [fetchAll]
  );

  const value = useMemo(
    () => ({
      status,
      protection,
      servers,
      policy,
      receipts,
      controlReceipts,
      openEscalations,
      openEscalationsLoaded,
      refreshEscalations,
      agentStats,
      toolStats,
      sessionGroups,
      serverStats,
      loading,
      error,
      degradeKind,
      lastUpdated,
      streamConnected,
      refetch: fetchAll,
      applyPlan,
      rollback,
      generatePlan,
      proposePolicy,
      activatePolicy,
      explainDecision,
      allowEscalated,
      allowAlwaysEscalated,
      blockEscalated,
      blockPermanentlyEscalated,
      allowSimilarEscalated,
      runSelfTest,
      getDeploymentManifest,
      askChat,
      agentChat,
    }),
    [
      status, protection, servers, policy, receipts, controlReceipts,
      agentStats, toolStats, sessionGroups, serverStats,
      loading, error, degradeKind, lastUpdated, streamConnected,
      fetchAll, applyPlan, rollback, generatePlan, proposePolicy,
      activatePolicy, explainDecision, allowEscalated, allowAlwaysEscalated,
      blockEscalated, blockPermanentlyEscalated, allowSimilarEscalated,
      runSelfTest, getDeploymentManifest, askChat, agentChat,
    ]
  );

  return <GatewayContext.Provider value={value}>{children}</GatewayContext.Provider>;
}

const DEFAULT_GATEWAY_CONTEXT: GatewayContextType = {
  status: null,
  protection: null,
  servers: [],
  policy: null,
  receipts: [],
  controlReceipts: [],
  openEscalations: [],
  openEscalationsLoaded: false,
  refreshEscalations: async () => {},
  agentStats: [],
  toolStats: [],
  sessionGroups: [],
  serverStats: [],
  loading: false,
  error: null,
  degradeKind: null,
  lastUpdated: 0,
  streamConnected: false,
  refetch: async () => {},
  applyPlan: async () => ({}),
  rollback: async () => ({}),
  generatePlan: async () => ({}),
  proposePolicy: async () => ({}),
  activatePolicy: async () => ({}),
  explainDecision: async () => ({
    receipt_id: '', tool_name: '', server_name: '', decision: '',
    reason: '', rule_id: null, intelligence_assessment: null, explanation: '',
  }),
  allowEscalated: async () => ({}),
  allowAlwaysEscalated: async () => ({}),
  blockEscalated: async () => ({}),
  blockPermanentlyEscalated: async () => ({}),
  allowSimilarEscalated: async () => ({}),
  runSelfTest: async () => ({
    status: 'UNAVAILABLE',
    total_cases: 0,
    passed_cases: 0,
  }),
  getDeploymentManifest: async () => ({}),
  askChat: async () => ({ answer: '', grounding: null }),
  agentChat: async () => ({ session_id: '', reply: '', tool_events: [], model_name: '' }),
};

export function useGateway(): GatewayContextType {
  const ctx = useContext(GatewayContext);
  return ctx ?? DEFAULT_GATEWAY_CONTEXT;
}

export function useGatewayStatus() {
  const gw = useGateway();
  return { status: gw.status, loading: gw.loading, error: gw.error, lastUpdated: gw.lastUpdated || Date.now() };
}

export function useGatewayProtection() {
  const gw = useGateway();
  return { protection: gw?.protection || null, loading: gw?.loading ?? false, error: gw?.error || null };
}

export function useGatewayServers() {
  const gw = useGateway();
  return { servers: gw?.servers || [], loading: gw?.loading ?? false, error: gw?.error || null };
}

export function useGatewayPolicy() {
  const gw = useGateway();
  return { policy: gw?.policy || null, loading: gw?.loading ?? false, error: gw?.error || null };
}

export function useGatewayReceipts() {
  const gw = useGateway();
  return { receipts: gw?.receipts || [], controlReceipts: gw?.controlReceipts || [], loading: gw?.loading ?? false, error: gw?.error || null };
}

export function useGatewayIntelligence() {
  const gw = useGateway();
  return gw?.status?.intelligence || null;
}
