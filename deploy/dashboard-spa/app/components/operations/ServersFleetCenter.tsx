'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  agenticPost,
  fetchCertificationRegistry,
  fetchFleetInstances,
  fetchHealth,
  fetchFleetHubStatus,
  fetchServerRegistry,
  resolveNpmPackageVersion,
  restartFleetHub,
  type FleetResponse,
  type HealthResponse,
  type UiMcpServerConfig,
} from '@/lib/mastyf-ai-api';
import { Card } from '@/app/components/ui/Card';
import { Badge } from '@/app/components/ui/Badge';
import { KpiCard } from '@/app/components/ui/KpiCard';
import { EmptyState } from '@/app/components/ui/EmptyState';
import { Button } from '@/app/components/ui/Button';
import { WorkspaceSubNav } from '@/app/components/ui/WorkspaceSubNav';
import { LiveMcpServersPanel } from '@/app/components/live/LiveMcpServersPanel';
import { HealthReliabilityPanel } from '@/app/components/dashboard/HealthReliabilityPanel';

type FleetView = 'overview' | 'health' | 'certifications';

type Props = {
  view: FleetView;
  onViewChange: (v: FleetView) => void;
  health: HealthResponse | null;
  refreshKey: number;
};

type CertificationRegistry = NonNullable<Awaited<ReturnType<typeof fetchCertificationRegistry>>>;
type CertificationCandidate = {
  serverName: string;
  packageName: string | null;
  version: string | null;
  transport: string;
  source: string;
  reason?: string;
};

function certificationBadgeVariant(level: string): 'success' | 'warning' | 'info' | 'neutral' {
  const normalized = level.toLowerCase();
  if (normalized === 'platinum' || normalized === 'gold') return 'success';
  if (normalized === 'silver') return 'info';
  if (normalized === 'bronze') return 'warning';
  return 'neutral';
}

const SCOPED_NPM = /@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*/i;

function inferPackageName(config?: Partial<UiMcpServerConfig> & { packageName?: string }): string | null {
  if (config?.packageName?.trim()) return config.packageName.trim();
  const command = config?.command?.trim().toLowerCase();
  const args = config?.args ?? [];
  for (const arg of args) {
    const scoped = arg.match(SCOPED_NPM)?.[0];
    if (scoped) return scoped;
  }
  if (command === 'npx' || command?.endsWith('/npx')) {
    return args.find((arg) => arg && !arg.startsWith('-') && !arg.includes('/')) ?? null;
  }
  return null;
}

function FleetOverview() {
  const [fleet, setFleet] = useState<FleetResponse | null>(null);
  const [hubStatus, setHubStatus] = useState<{ running: number; total: number }>({ running: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [restarting, setRestarting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [f, hub] = await Promise.all([
      fetchFleetInstances().catch(() => null),
      fetchFleetHubStatus().catch(() => ({ entries: [], fleet: null })),
    ]);
    if (f) setFleet(f);
    const running = hub.fleet?.servers.filter((s) => s.status === 'running').length ?? 0;
    setHubStatus({ running, total: hub.entries.length });
    setLoading(false);
  }, []);

  const handleRestartFleet = async () => {
    setRestarting(true);
    await restartFleetHub().catch(() => ({ ok: false }));
    setRestarting(false);
    await load();
  };

  useEffect(() => { void load(); }, [load]);

  const totalInstances = fleet?.totalInstances ?? 0;
  const activeInstances = fleet?.activeInstances ?? 0;
  const totalRequests = fleet?.totalRequests ?? 0;
  const totalBlocked = fleet?.totalBlocked ?? 0;
  const totalCost = fleet?.totalCostUsd ?? 0;
  const instances = fleet?.instances ?? [];

  const blockRate = totalRequests > 0 ? ((totalBlocked / totalRequests) * 100).toFixed(1) : '0.0';

  const onlineCount = instances.filter(i => i.status === 'online' || i.status === 'active').length;
  const offlineCount = instances.filter(i => i.status === 'offline' || i.status === 'down').length;
  const degradedCount = instances.filter(i => i.status === 'degraded').length;

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-muted" style={{ margin: 0 }}>
          Fleet Hub: {hubStatus.running}/{hubStatus.total} servers running
        </p>
        <Button variant="secondary" size="sm" disabled={restarting} onClick={() => void handleRestartFleet()}>
          {restarting ? 'Restarting…' : 'Restart Fleet'}
        </Button>
      </div>
      <div className="kpi-grid">
        <KpiCard label="Fleet Hub" value={`${hubStatus.running}/${hubStatus.total}`} accent={hubStatus.running > 0 ? 'success' : 'neutral'} secondary="protected servers" />
        <KpiCard label="Total Instances" value={totalInstances} accent="info" secondary={`${activeInstances} active`} />
        <KpiCard label="Fleet Status" value={onlineCount > 0 ? `${onlineCount} online` : 'Offline'} accent={onlineCount > 0 ? 'success' : 'danger'} />
        <KpiCard label="Total Requests" value={totalRequests.toLocaleString()} accent="info" secondary={`${blockRate}% blocked`} />
        <KpiCard label="Total Cost" value={`$${totalCost.toFixed(2)}`} accent="neutral" />
      </div>

      <Card title="Fleet Instances" subtitle="All registered MCP server instances">
        {loading ? (
          <p className="text-sm text-muted">Loading fleet…</p>
        ) : instances.length === 0 ? (
          <EmptyState title="No instances" message="No MCP server instances are registered" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Instance</th>
                  <th>Hostname</th>
                  <th>Status</th>
                  <th>Requests</th>
                  <th>Blocked</th>
                  <th>Latency</th>
                  <th>Cost</th>
                  <th>Last Heartbeat</th>
                </tr>
              </thead>
              <tbody>
                {instances.map((inst) => (
                  <tr key={inst.instanceId} className={inst.status === 'offline' || inst.status === 'down' ? 'row-critical' : inst.status === 'degraded' ? 'row-warning' : ''}>
                    <td><code className="text-xs">{inst.instanceId}</code></td>
                    <td>{inst.hostname || '—'}</td>
                    <td>
                      <Badge variant={inst.status === 'online' || inst.status === 'active' ? 'live' : inst.status === 'degraded' ? 'degraded' : 'offline'} dot>
                        {inst.status || 'unknown'}
                      </Badge>
                    </td>
                    <td className="mono">{inst.totalRequests?.toLocaleString() ?? '—'}</td>
                    <td className="mono">{inst.blockedRequests?.toLocaleString() ?? '—'}</td>
                    <td className="mono">{inst.avgLatencyMs != null ? `${inst.avgLatencyMs.toFixed(0)}ms` : '—'}</td>
                    <td className="mono">{inst.totalCostUsd != null ? `$${inst.totalCostUsd.toFixed(2)}` : '—'}</td>
                    <td className="text-xs text-muted">{inst.lastHeartbeat ? new Date(inst.lastHeartbeat).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Server Configuration" subtitle="Manage MCP server definitions">
        <LiveMcpServersPanel />
      </Card>
    </>
  );
}

function CertificationRegistryView({ refreshKey }: { refreshKey: number }) {
  const [registry, setRegistry] = useState<CertificationRegistry | null>(null);
  const [candidates, setCandidates] = useState<CertificationCandidate[]>([]);
  const [versionByServer, setVersionByServer] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [certifying, setCertifying] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setActionMessage(null);
    let loadError: string | null = null;
    const [result, serverRegistry] = await Promise.all([
      fetchCertificationRegistry().catch((err: unknown) => {
        loadError = err instanceof Error ? err.message : 'Certification registry unavailable';
        return null;
      }),
      fetchServerRegistry().catch(() => ({ servers: [], uiServers: [], unified: [] })),
    ]);
    const discovered = (serverRegistry.unified ?? []).map((server) => {
      const packageName = inferPackageName(server.config);
      const version = server.config?.version?.trim() || null;
      return {
        serverName: server.name,
        packageName,
        version,
        transport: server.transport,
        source: server.source,
        reason: packageName
          ? version ? undefined : 'Exact deployed version is not pinned in config'
          : 'Package name is not available from server config',
      };
    });
    setRegistry(result);
    setCandidates(discovered);
    setVersionByServer(Object.fromEntries(discovered.map((candidate) => [
      candidate.serverName,
      candidate.version ?? '',
    ])));
    setError(loadError ?? (result ? null : 'Certification registry unavailable'));
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const certifications = registry?.certifications ?? [];
  const expiringSoon = certifications.filter((cert) => {
    const expires = Date.parse(cert.expiresAt);
    if (!Number.isFinite(expires)) return false;
    return expires - Date.now() <= 30 * 24 * 60 * 60 * 1000;
  }).length;
  const avgScore = certifications.length > 0
    ? Math.round(certifications.reduce((sum, cert) => sum + cert.score, 0) / certifications.length)
    : null;
  const certifiedCount = certifications.filter((cert) => cert.certified !== false).length;
  const uncertifiedCandidates = candidates.filter(
    (candidate) => !certifications.some((cert) => cert.serverName === candidate.serverName),
  );

  const certifyCandidate = async (candidate: CertificationCandidate) => {
    const version = (versionByServer[candidate.serverName] ?? '').trim();
    if (!candidate.packageName || !version) return;
    setCertifying(candidate.serverName);
    setActionMessage(null);
    const result = await agenticPost('/api/agentic/certification/certify', {
      serverName: candidate.serverName,
      packageName: candidate.packageName,
      version,
      transport: candidate.transport,
    });
    setCertifying(null);
    if (!result.ok) {
      setActionMessage(result.error ?? 'Certification failed');
      return;
    }
    setActionMessage(`Certification recorded for ${candidate.serverName}.`);
    await load();
  };

  const resolveCandidateVersion = async (candidate: CertificationCandidate) => {
    if (!candidate.packageName) return;
    setResolving(candidate.serverName);
    setActionMessage(null);
    try {
      const resolved = await resolveNpmPackageVersion(candidate.packageName);
      if (!resolved?.version) {
        setActionMessage(`No registry version found for ${candidate.packageName}.`);
        return;
      }
      setVersionByServer((current) => ({
        ...current,
        [candidate.serverName]: resolved.version,
      }));
      setActionMessage(`Resolved ${candidate.packageName}@${resolved.version} from npm registry.`);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Version resolution failed');
    } finally {
      setResolving(null);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted">Loading certifications…</p>;
  }

  if (error) {
    return <EmptyState title="Certification registry unavailable" message={error} />;
  }

  return (
    <>
      <div className="kpi-grid">
        <KpiCard label="Registry Entries" value={registry?.count ?? certifications.length} accent={certifications.length > 0 ? 'info' : 'neutral'} />
        <KpiCard label="Certified Servers" value={certifiedCount} accent={certifiedCount > 0 ? 'success' : 'neutral'} />
        <KpiCard label="Average Score" value={avgScore === null ? 'Unavailable' : `${avgScore}/100`} accent={avgScore !== null && avgScore >= 80 ? 'success' : 'neutral'} />
        <KpiCard label="Expiring Soon" value={expiringSoon} accent={expiringSoon > 0 ? 'warning' : 'neutral'} secondary="next 30 days" />
      </div>

      <Card title="Certification Registry" subtitle="Published server certifications and attestations">
        {certifications.length === 0 ? (
          <EmptyState
            title="No certifications registered"
            message="No server has a signed certification attestation in the registry yet."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Server</th>
                  <th>Package</th>
                  <th>Level</th>
                  <th>Score</th>
                  <th>Status</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {certifications.map((cert) => (
                  <tr key={`${cert.serverName}-${cert.packageName}`}>
                    <td>{cert.serverName}</td>
                    <td><code className="text-xs">{cert.packageName}</code></td>
                    <td>
                      <Badge variant={certificationBadgeVariant(cert.level)}>
                        {cert.level || 'standard'}
                      </Badge>
                    </td>
                    <td className="mono">{cert.score}/100</td>
                    <td>
                      <Badge variant={cert.certified === false ? 'warning' : 'success'}>
                        {cert.certified === false ? 'attested' : 'certified'}
                      </Badge>
                    </td>
                    <td className="text-xs text-muted">
                      {cert.expiresAt ? new Date(cert.expiresAt).toLocaleString() : 'Unavailable'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Certify Observed Servers" subtitle="Create certifications from real security scan and proxy history data">
        {actionMessage && <p className="text-sm text-muted">{actionMessage}</p>}
        {uncertifiedCandidates.length === 0 ? (
          <EmptyState title="No uncertified servers" message="All discovered servers already have registry entries." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Server</th>
                  <th>Package</th>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Action</th>
                      <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {uncertifiedCandidates.map((candidate) => {
                  const version = (versionByServer[candidate.serverName] ?? '').trim();
                  const canCertify = Boolean(candidate.packageName && version);
                  return (
                    <tr key={candidate.serverName}>
                      <td>{candidate.serverName}</td>
                      <td>
                        {candidate.packageName ? <code className="text-xs">{candidate.packageName}</code> : 'Unavailable'}
                      </td>
                      <td>
                        <input
                          className="input"
                          style={{ minWidth: 140 }}
                          placeholder="Exact version"
                          value={versionByServer[candidate.serverName] ?? ''}
                          onChange={(event) => setVersionByServer((current) => ({
                            ...current,
                            [candidate.serverName]: event.target.value,
                          }))}
                        />
                      </td>
                      <td className="text-xs text-muted">
                        {!candidate.packageName
                          ? 'Package name unavailable'
                          : version
                            ? 'Ready'
                            : 'Resolve exact npm version before certifying'}
                      </td>
                      <td>
                        {!candidate.packageName ? (
                          <Button size="sm" variant="secondary" disabled>
                            Unavailable
                          </Button>
                        ) : canCertify ? (
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={certifying === candidate.serverName}
                            onClick={() => void certifyCandidate(candidate)}
                          >
                            {certifying === candidate.serverName ? 'Certifying…' : 'Certify'}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={resolving === candidate.serverName}
                            onClick={() => void resolveCandidateVersion(candidate)}
                          >
                            {resolving === candidate.serverName ? 'Resolving…' : 'Resolve version'}
                          </Button>
                        )}
                      </td>
                      <td>{candidate.source}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

export function ServersFleetCenter({ view, onViewChange, health, refreshKey }: Props) {
  const VIEW_TABS = [
    { id: 'overview' as const, label: 'Fleet Overview' },
    { id: 'health' as const, label: 'Health & Performance' },
    { id: 'certifications' as const, label: 'Certifications' },
  ];

  return (
    <section aria-label="MCP Fleet Management">
      <div className="page-header">
        <div>
          <h1>MCP Fleet Management</h1>
          <p>Operational status, health, and configuration of all MCP servers</p>
        </div>
      </div>

      <WorkspaceSubNav tabs={VIEW_TABS} active={view} onChange={onViewChange} />

      {view === 'overview' && <FleetOverview />}
      {view === 'health' && <HealthReliabilityPanel health={health} refreshKey={refreshKey} />}
      {view === 'certifications' && <CertificationRegistryView refreshKey={refreshKey} />}
    </section>
  );
}
