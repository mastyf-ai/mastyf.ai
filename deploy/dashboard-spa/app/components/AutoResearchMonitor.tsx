'use client';

import { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
} from 'recharts';
import type { AutoCorpusEntry, ThreatDiscoveryStatus } from '@/lib/guardian-api';
import { SOURCE_LABELS } from '@/lib/threat-discovery-copy';
import { CHART_AXIS, CHART_GRID } from '@/lib/chartTheme';
import { ThreatCandidateDrawer } from './ThreatCandidateDrawer';

type Props = {
  entries: AutoCorpusEntry[];
  status: ThreatDiscoveryStatus | null;
};

function skipSummary(parsed: NonNullable<ThreatDiscoveryStatus['jobs']['autoResearch']['parsed']>): string[] {
  const lines: string[] = [];
  const { skips } = parsed;
  if (skips.llmUnavailable > 0) lines.push(`${skips.llmUnavailable} LLM unavailable`);
  if (skips.replayFailed > 0) lines.push(`${skips.replayFailed} replay validation failed`);
  if (skips.belowMinConfidence > 0) lines.push(`${skips.belowMinConfidence} below min confidence`);
  if (skips.llmDiscoveryNull > 0) lines.push(`${skips.llmDiscoveryNull} LLM returned no discovery`);
  if (skips.duplicate > 0) lines.push(`${skips.duplicate} duplicate fingerprint`);
  if (skips.other > 0) lines.push(`${skips.other} other`);
  return lines;
}

export function AutoResearchMonitor({ entries, status }: Props) {
  const [selected, setSelected] = useState<AutoCorpusEntry | null>(null);
  const pipeline = status?.pipeline;
  const parsed = status?.jobs?.autoResearch?.parsed;
  const ratePct =
    pipeline && pipeline.maxPerHour > 0
      ? Math.round((pipeline.writesThisHour / pipeline.maxPerHour) * 100)
      : 0;

  const timeline = (status?.autoCorpus.stats.timeline || []).map((t) => ({
    ...t,
    label: new Date(t.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  }));

  const sourceData = Object.entries(status?.autoCorpus.stats.bySource || {}).map(
    ([name, value]) => ({
      name: SOURCE_LABELS[name] || name.replace(/_/g, ' '),
      value,
    }),
  );

  const lastJobZeroWrites =
    parsed != null && parsed.attempted > 0 && parsed.written === 0;
  const skipLines = parsed ? skipSummary(parsed) : [];

  return (
    <div className="auto-research-monitor">
      <p className="hint">
        Read-only audit of fixtures written by Auto Threat Research — policy is never auto-applied.
      </p>

      {!status?.llm.ok ? (
        <p className="status status-error banner-inline">
          LLM unavailable — auto-fixtures require Ollama at{' '}
          <code>OLLAMA_BASE_URL</code>: {status?.llm.reason || 'Configure Ollama and set GUARDIAN_LLM_ENABLED=true'}
        </p>
      ) : null}

      {lastJobZeroWrites ? (
        <p className="status status-warning banner-inline">
          Last batch wrote 0/{parsed?.attempted ?? 0} fixtures
          {skipLines.length ? ` — ${skipLines.join(', ')}` : ''}.
          {parsed?.skips.duplicate && parsed.skips.duplicate >= (parsed.attempted ?? 0) ? (
            <> All batch signals were already processed — new fixtures need fresh MCP blocks or bypass findings.</>
          ) : null}
          {parsed?.skips.replayFailed ? (
            <> Corpus replay uses <code>GUARDIAN_CORPUS_REPLAY_POLICY_PATH</code> (default: strict default-policy.yaml).</>
          ) : null}
        </p>
      ) : null}

      {!status?.features.autoResearchEnabled ? (
        <p className="hint banner-inline">
          Auto research disabled — set <code>GUARDIAN_THREAT_RESEARCH_AUTO=true</code> and{' '}
          <code>SWARM_THREAT_RESEARCH_AUTO=true</code> on the proxy, or use Run Auto Research.
        </p>
      ) : null}

      <div className="rate-limit-gauge">
        <div className="rate-limit-label">
          Hourly write cap: {pipeline?.writesThisHour ?? 0} / {pipeline?.maxPerHour ?? 20}
        </div>
        <div className="rate-limit-bar">
          <div
            className="rate-limit-fill"
            style={{ width: `${Math.min(ratePct, 100)}%` }}
          />
        </div>
      </div>

      <div className="infra-charts-grid">
        <div className="infra-chart-card">
          <h5>Writes over time</h5>
          {timeline.length === 0 ? (
            <p className="muted">No auto corpus entries yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={timeline}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="label" {...CHART_AXIS} />
                <YAxis hide domain={[0, 1]} />
                <Tooltip />
                <Line type="monotone" dataKey="confidence" stroke="#38bdf8" dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="infra-chart-card">
          <h5>By source</h5>
          {sourceData.length === 0 ? (
            <p className="muted">No data.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={sourceData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#16a34a" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {parsed && (parsed.attempted > 0 || parsed.summaryLine) ? (
        <p className="hint">
          Last batch: {parsed.written}/{parsed.attempted} written
          {parsed.summaryLine ? ` · ${parsed.summaryLine}` : ''}
        </p>
      ) : null}

      {entries.length === 0 ? (
        <p className="muted">No auto corpus additions yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Fixture</th>
              <th>Tool</th>
              <th>Source</th>
              <th>Confidence</th>
              <th>Timestamp</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.advId}>
                <td>
                  <div>{e.advId}</div>
                  <div className="hint fixture-path">{e.relPath}</div>
                </td>
                <td>{e.toolName || '—'}</td>
                <td title={e.hypothesis}>{SOURCE_LABELS[e.source] || e.source}</td>
                <td>{(e.confidence * 100).toFixed(0)}%</td>
                <td>{new Date(e.timestamp).toLocaleString()}</td>
                <td>
                  <button type="button" className="secondary btn-sm" onClick={() => setSelected(e)}>
                    Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected ? (
        <ThreatCandidateDrawer autoEntry={selected} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}
