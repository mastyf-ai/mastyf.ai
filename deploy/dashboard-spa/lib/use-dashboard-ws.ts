'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchSwarmStatus,
  getTenantId,
  resolveWsUrl,
  type AggregateMetrics,
  type AuditEvent,
  type AuditResponse,
  type SwarmJobStatus,
  type WsDashboardMessage,
} from '@/lib/guardian-api';
import {
  pipelineFromSwarmJob,
  type FlowTimelineEntry,
  type PipelineState,
  type FlowStepKind,
  type FlowSeverity,
} from '@/lib/flow-types';

const MAX_ENTRIES = 200;
const WS_DISCONNECT_STATUS_AFTER_ATTEMPTS = 2;
const SWARM_POLL_MS = 1500;

export type DashboardWsState = {
  connected: boolean;
  statusText: string;
  statusIsError: boolean;
  entries: FlowTimelineEntry[];
  pipeline: PipelineState;
  metricsPatch: AggregateMetrics | null;
  auditPatch: AuditResponse | null;
  swarmDoneTick: number;
  aiRefreshTick: number;
  pushEntry: (channel: string, summary: string, blocked: boolean) => void;
  /** Sync pipeline from HTTP status (SwarmRunControls poll + fallback timer) */
  syncSwarmJobStatus: (job: SwarmJobStatus) => void;
};

function severityFromBlocked(blocked: boolean): FlowSeverity {
  return blocked ? 'warn' : 'success';
}

function stepFromPayload(msg: WsDashboardMessage): FlowTimelineEntry | null {
  const step = msg.payload?.step as Record<string, unknown> | undefined;
  if (!step || typeof step !== 'object') return null;
  return {
    id: String(step.id ?? `flow-${msg.timestamp}`),
    kind: (step.kind as FlowStepKind) || 'system',
    title: String(step.title ?? 'Event'),
    summary: String(step.summary ?? ''),
    severity: (step.severity as FlowSeverity) || 'info',
    channel: 'flow',
    serverName: step.serverName ? String(step.serverName) : undefined,
    toolName: step.toolName ? String(step.toolName) : undefined,
    requestId: step.requestId ? String(step.requestId) : undefined,
    timestamp: msg.timestamp || Date.now(),
    metadata: (step.metadata as Record<string, unknown>) || undefined,
  };
}

function initialPipeline(): PipelineState {
  return {
    activePhaseId: null,
    activeIndex: -1,
    progressPct: 0,
    state: 'idle',
  };
}

export function useDashboardWs(enabled: boolean, sessionKey: number): DashboardWsState {
  const [connected, setConnected] = useState(false);
  const [statusText, setStatusText] = useState('Connecting…');
  const [statusIsError, setStatusIsError] = useState(false);
  const [entries, setEntries] = useState<FlowTimelineEntry[]>([]);
  const [pipeline, setPipeline] = useState<PipelineState>(initialPipeline);
  const [metricsPatch, setMetricsPatch] = useState<AggregateMetrics | null>(null);
  const [auditPatch, setAuditPatch] = useState<AuditResponse | null>(null);
  const [swarmDoneTick, setSwarmDoneTick] = useState(0);
  const [aiRefreshTick, setAiRefreshTick] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(0);
  const lastSwarmPhaseRef = useRef('');

  const appendEntry = useCallback((entry: FlowTimelineEntry) => {
    setEntries((prev) => [entry, ...prev].slice(0, MAX_ENTRIES));
  }, []);

  const syncSwarmJobStatus = useCallback(
    (job: SwarmJobStatus) => {
      const next = pipelineFromSwarmJob(job);
      setPipeline(next);

      const phaseKey = `${job.state}:${job.phase}`;
      if (
        job.state === 'running' &&
        job.phase &&
        phaseKey !== lastSwarmPhaseRef.current
      ) {
        lastSwarmPhaseRef.current = phaseKey;
        appendEntry({
          id: `swarm-poll-${job.phase}-${Date.now()}`,
          kind: 'swarm_phase',
          title: job.phaseLabel || job.phase,
          summary: `Analysis ${job.progressPct ?? 0}%`,
          severity: 'info',
          channel: 'swarm',
          timestamp: Date.now(),
        });
      }
      if (job.state === 'done' && lastSwarmPhaseRef.current !== 'done:') {
        lastSwarmPhaseRef.current = 'done:';
        setSwarmDoneTick((t) => t + 1);
        appendEntry({
          id: `swarm-done-${Date.now()}`,
          kind: 'swarm_done',
          title: 'Security analysis complete',
          summary: 'Artifacts ready',
          severity: 'success',
          channel: 'swarm',
          timestamp: Date.now(),
        });
      }
      if (job.state === 'failed' && lastSwarmPhaseRef.current !== 'failed:') {
        lastSwarmPhaseRef.current = 'failed:';
        appendEntry({
          id: `swarm-fail-${Date.now()}`,
          kind: 'swarm_failed',
          title: 'Security analysis failed',
          summary: job.error || 'failed',
          severity: 'error',
          channel: 'swarm',
          timestamp: Date.now(),
        });
      }
    },
    [appendEntry],
  );

  const pushEntry = useCallback(
    (channel: string, summary: string, blocked: boolean) => {
      seqRef.current += 1;
      appendEntry({
        id: `local-${seqRef.current}`,
        kind: 'system',
        title: channel,
        summary,
        severity: severityFromBlocked(blocked),
        channel,
        timestamp: Date.now(),
      });
    },
    [appendEntry],
  );

  const handleMessage = useCallback(
    (msg: WsDashboardMessage) => {
      const type = msg.type || '';

      if (type === 'flow:step') {
        const step = stepFromPayload(msg);
        if (step) appendEntry(step);
        return;
      }

      if (type === 'policy-block' || type === 'audit:decision') {
        const p = msg.payload || {};
        const tool = String(p.toolName || p.tool_name || 'tool');
        const rule = String(p.rule || p.blockRule || 'policy');
        const blocked = type === 'policy-block' || !!p.blocked;
        appendEntry({
          id: `policy-${Date.now()}-${seqRef.current++}`,
          kind: blocked ? 'policy_block' : 'policy_pass',
          title: blocked ? `Blocked ${tool}` : `Allowed ${tool}`,
          summary: blocked ? `${rule}` : `${tool} passed`,
          severity: blocked ? 'warn' : 'success',
          channel: 'policy',
          serverName: msg.serverName,
          toolName: tool,
          timestamp: msg.timestamp || Date.now(),
          metadata: p as Record<string, unknown>,
        });
        return;
      }

      if (type === 'semantic:queued' || type === 'semantic:complete') {
        const p = msg.payload || {};
        appendEntry({
          id: `sem-${type}-${Date.now()}`,
          kind: type === 'semantic:queued' ? 'semantic_queued' : 'semantic_complete',
          title: type === 'semantic:queued' ? `Semantic queued: ${p.toolName}` : `Semantic: ${p.toolName}`,
          summary: String(p.reasoning || p.syncRule || type),
          severity: p.suspicious ? 'warn' : 'info',
          channel: 'semantic',
          serverName: msg.serverName,
          toolName: p.toolName ? String(p.toolName) : undefined,
          requestId: p.requestId ? String(p.requestId) : undefined,
          timestamp: msg.timestamp || Date.now(),
          metadata: p as Record<string, unknown>,
        });
        if (type === 'semantic:complete') setAiRefreshTick((t) => t + 1);
        return;
      }

      if (type === 'swarm:progress') {
        const p = msg.payload || {};
        syncSwarmJobStatus({
          jobId: String(p.jobId ?? ''),
          state: 'running',
          phase: String(p.phase || ''),
          phaseLabel: String(p.phaseLabel || p.phase || ''),
          progressPct: Number(p.progressPct ?? 0),
          startedAt: null,
          finishedAt: null,
          exitCode: null,
          error: null,
          analysisPath: '',
          logTail: '',
        });
        return;
      }

      if (type === 'swarm:done' || type === 'swarm:failed') {
        syncSwarmJobStatus({
          jobId: String(msg.payload?.jobId ?? ''),
          state: type === 'swarm:done' ? 'done' : 'failed',
          phase: 'analysis',
          phaseLabel: type === 'swarm:done' ? 'Complete' : 'Failed',
          progressPct: type === 'swarm:done' ? 100 : 0,
          startedAt: null,
          finishedAt: null,
          exitCode: null,
          error: type === 'swarm:failed' ? String(msg.payload?.error ?? '') : null,
          analysisPath: '',
          logTail: '',
        });
        return;
      }

      if (type === 'analysis:artifact') {
        appendEntry({
          id: `artifact-${Date.now()}`,
          kind: 'analysis_ready',
          title: 'Analysis artifacts updated',
          summary: String((msg.payload?.paths as string[])?.join(', ') || 'report.json, latest.json'),
          severity: 'success',
          channel: 'swarm',
          timestamp: msg.timestamp || Date.now(),
        });
        setSwarmDoneTick((t) => t + 1);
        return;
      }

      if (type.startsWith('ai:')) {
        setAiRefreshTick((t) => t + 1);
        const sug = msg.payload?.suggestions;
        const n = Number(msg.payload?.count ?? (Array.isArray(sug) ? sug.length : 0));
        pushEntry('ai', `${n} suggestion(s) updated`, false);
        return;
      }

      if (type === 'audit:events') {
        const evts = (msg.payload?.events as AuditEvent[]) || [];
        if (evts.length > 0) {
          setAuditPatch((prev) => ({
            events: evts,
            total: prev?.total ?? evts.length,
            blocked: prev?.blocked ?? 0,
            passed: prev?.passed ?? 0,
            flagged: prev?.flagged ?? 0,
          }));
        }
        pushEntry('audit', `${evts.length} audit event(s)`, false);
        return;
      }

      if (type === 'metrics:live') {
        const m = msg.payload?.metrics as AggregateMetrics | undefined;
        if (m) setMetricsPatch(m);
        pushEntry('metrics', 'Metrics refresh', false);
        return;
      }

      if (type === 'snapshot') {
        pushEntry('system', 'Dashboard connected', false);
        return;
      }

      pushEntry(type.split(':')[0] || 'event', type, false);
    },
    [appendEntry, pushEntry, syncSwarmJobStatus],
  );

  /** HTTP fallback: job.json updates even when WS swarm events miss */
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const poll = async () => {
      const st = await fetchSwarmStatus();
      if (cancelled || !st) return;
      syncSwarmJobStatus(st);
    };

    void poll();
    const id = window.setInterval(() => void poll(), SWARM_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled, sessionKey, syncSwarmJobStatus]);

  useEffect(() => {
    lastSwarmPhaseRef.current = '';
  }, [sessionKey]);

  useEffect(() => {
    if (!enabled) return;

    const wsUrl = resolveWsUrl();
    let reconnectAttempt = 0;
    let reconnectTimer: number | null = null;
    let intentionalClose = false;

    function applyStatus(text: string, isError: boolean) {
      setStatusText(text);
      setStatusIsError(isError);
    }

    function scheduleReconnect() {
      if (intentionalClose) return;
      const delay = Math.min(30_000, 1000 * 2 ** reconnectAttempt);
      reconnectAttempt += 1;
      if (reconnectAttempt >= WS_DISCONNECT_STATUS_AFTER_ATTEMPTS) {
        setConnected(false);
        applyStatus('WebSocket disconnected — retrying…', true);
      }
      reconnectTimer = window.setTimeout(connectWs, delay);
    }

    function connectWs() {
      if (intentionalClose) return;
      const existing = wsRef.current;
      if (
        existing &&
        (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }
      existing?.close();
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempt = 0;
        setConnected(true);
        applyStatus('WebSocket connected — live agent flow', false);
        ws.send(
          JSON.stringify({
            type: 'subscribe',
            channels: ['flow', 'policy', 'health', 'metrics', 'audit', 'ai', 'cost', 'swarm'],
            tenantId: getTenantId(),
          }),
        );
      };

      ws.onclose = (ev) => {
        if (wsRef.current === ws) wsRef.current = null;
        setConnected(false);
        if (ev.code === 4401) {
          applyStatus('Subscription or authentication required for WebSocket', true);
          intentionalClose = true;
          return;
        }
        if (ev.code === 4403) {
          applyStatus('Subscription inactive — WebSocket closed', true);
          intentionalClose = true;
          return;
        }
        scheduleReconnect();
      };

      ws.onerror = () => {
        if (reconnectAttempt >= WS_DISCONNECT_STATUS_AFTER_ATTEMPTS) {
          applyStatus('WebSocket error', true);
        }
      };

      ws.onmessage = (ev) => {
        try {
          handleMessage(JSON.parse(ev.data as string) as WsDashboardMessage);
        } catch {
          pushEntry('raw', String(ev.data).slice(0, 80), false);
        }
      };
    }

    connectWs();

    return () => {
      intentionalClose = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [enabled, sessionKey, handleMessage, pushEntry]);

  return {
    connected,
    statusText,
    statusIsError,
    entries,
    pipeline,
    metricsPatch,
    auditPatch,
    swarmDoneTick,
    aiRefreshTick,
    pushEntry,
    syncSwarmJobStatus,
  };
}
