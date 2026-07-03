'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchComplianceReport,
  fetchPlanComplianceAudit,
  fetchContinuousAssuranceReport,
  fetchCertificationRegistry,
  fetchComplianceFrameworkPosture,
  fetchComplianceEvidence,
  generateComplianceEvidence,
  type ComplianceEvidenceArtifact,
  type ComplianceFrameworkPosture,
  type PlanComplianceReport,
  type ContinuousAssuranceReport,
} from '@/lib/mastyf-ai-api';
import { Card } from '@/app/components/ui/Card';
import { Badge } from '@/app/components/ui/Badge';
import { Button } from '@/app/components/ui/Button';
import { KpiCard } from '@/app/components/ui/KpiCard';
import { EmptyState } from '@/app/components/ui/EmptyState';
import { WorkspaceSubNav } from '@/app/components/ui/WorkspaceSubNav';

type CompView = 'overview' | 'frameworks' | 'evidence';

type Props = {
  view: CompView;
  onViewChange: (v: CompView) => void;
  refreshKey: number;
};

const VIEW_TABS = [
  { id: 'overview' as const, label: 'Compliance Posture' },
  { id: 'frameworks' as const, label: 'Frameworks' },
  { id: 'evidence' as const, label: 'Evidence' },
];

/* ── Overview ─────────────────────────────────── */

function OverviewView({ refreshKey }: { refreshKey: number }) {
  const [compliance, setCompliance] = useState<any>(null);
  const [plan, setPlan] = useState<PlanComplianceReport | null>(null);
  const [assurance, setAssurance] = useState<ContinuousAssuranceReport | null>(null);
  const [certs, setCerts] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, p, a, cert] = await Promise.all([
      fetchComplianceReport().catch(() => null),
      fetchPlanComplianceAudit().catch(() => null),
      fetchContinuousAssuranceReport().catch(() => null),
      fetchCertificationRegistry().catch(() => null),
    ]);
    if (c) setCompliance(c);
    if (p) setPlan(p);
    if (a) setAssurance(a);
    if (cert) setCerts(cert);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const overallScore = plan?.overallScore ?? null;
  const modulesCount = plan?.modules?.length ?? 0;
  const certCount = certs?.count ?? 0;
  const controlCount = assurance?.controls ? Object.keys(assurance.controls).length : 0;

  return (
    <>
      <div className="kpi-grid">
        <KpiCard
          label="Compliance Score"
          value={overallScore != null ? `${overallScore}/100` : '—'}
          accent={overallScore != null ? (overallScore >= 80 ? 'success' : overallScore >= 50 ? 'warning' : 'danger') : 'neutral'}
        />
        <KpiCard label="Certifications" value={certCount} accent={certCount > 0 ? 'success' : 'neutral'} />
        <KpiCard label="Control Modules" value={modulesCount} accent="info" />
        <KpiCard label="Active Controls" value={controlCount} accent="info" />
      </div>

      <div className="grid grid-12">
        <div className="col-span-8">
          <Card title="Plan Compliance Audit" subtitle="Modular compliance assessment">
            {loading ? (
              <p className="text-sm text-muted">Loading compliance data…</p>
            ) : plan?.error && (!plan.modules || plan.modules.length === 0) ? (
              <EmptyState title="Compliance audit failed" message={plan.error} />
            ) : plan ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="flex items-center gap-3">
                  <Badge variant={plan.productionReady ? 'success' : 'warning'} dot>
                    {plan.productionReady ? 'Production Ready' : 'Pending'}
                  </Badge>
                  <span className="text-sm text-muted">Generated {plan.generatedAt ? new Date(plan.generatedAt).toLocaleString() : '—'}</span>
                </div>
                {plan.modules && plan.modules.length > 0 ? (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Module</th>
                          <th>Score</th>
                          <th>Checks Passed</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.modules.map((mod, i) => (
                          <tr key={i} className={mod.score < 50 ? 'row-critical' : mod.score < 80 ? 'row-warning' : ''}>
                            <td className="font-medium">{mod.name}</td>
                            <td className="mono">{mod.score}/100</td>
                            <td className="text-sm">{mod.checks.filter(c => c.passed).length}/{mod.checks.length}</td>
                            <td className="text-sm">{mod.checks.filter(c => !c.passed).map(c => c.detail).join('; ') || 'All checks passed'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-muted">No modules assessed</p>
                )}
              </div>
            ) : (
              <EmptyState title="No compliance data" message="Compliance audit data will appear once plan assessment is configured" />
            )}
          </Card>
        </div>

        <div className="col-span-4">
          <Card title="Continuous Assurance" subtitle="Real-time control monitoring">
            {assurance ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="text-sm">
                  <span className="text-muted">Tenant:</span> {assurance.tenantId || '—'}
                </div>
                <div className="text-sm">
                  <span className="text-muted">Generated:</span> {assurance.generatedAt ? new Date(assurance.generatedAt).toLocaleString() : '—'}
                </div>
                {assurance.metrics && (
                  <>
                    <div className="text-sm">
                      <span className="text-muted">Total calls:</span> {assurance.metrics.totalCalls.toLocaleString()}
                    </div>
                    <div className="text-sm">
                      <span className="text-muted">Block rate:</span> {(assurance.metrics.blockedRate * 100).toFixed(1)}%
                    </div>
                    <div className="text-sm">
                      <span className="text-muted">Latency:</span> {assurance.metrics.avgLatencyMs.toFixed(0)}ms
                    </div>
                    <div className="text-sm">
                      <span className="text-muted">Controls:</span> {Object.keys(assurance.controls).length} active
                    </div>
                  </>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">No assurance data</p>
            )}
          </Card>

          <Card title="Certifications" subtitle="Server certifications & attestations">
            {certs?.certifications && certs.certifications.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {certs.certifications.slice(0, 5).map((c: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <Badge variant={c.level === 'critical' ? 'danger' : c.level === 'high' ? 'warning' : 'success'}>
                      {c.level || 'standard'}
                    </Badge>
                    <span className="truncate">{c.serverName}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No certifications registered</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

/* ── Frameworks ──────────────────────────────── */

function FrameworksView({ refreshKey }: { refreshKey: number }) {
  const [frameworks, setFrameworks] = useState<ComplianceFrameworkPosture[]>([]);
  const [overall, setOverall] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchComplianceFrameworkPosture().catch((err: unknown) => ({
      frameworks: [],
      overall: null,
      available: false,
      error: err instanceof Error ? err.message : 'Compliance framework posture unavailable',
    }));
    setFrameworks(result.frameworks);
    setOverall(result.overall);
    setError(result.error ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  if (loading) return <p className="text-sm text-muted">Loading frameworks…</p>;

  if (error && frameworks.length === 0) {
    return <EmptyState title="Framework posture unavailable" message={error} />;
  }

  if (frameworks.length === 0) {
    return <EmptyState title="No frameworks" message="No compliance framework posture data is available" />;
  }

  return (
    <Card
      title="Compliance Frameworks"
      subtitle="Framework posture from live policy, proxy audit, and security scan evidence"
      actions={overall != null ? <Badge variant={overall >= 80 ? 'success' : overall >= 50 ? 'warning' : 'danger'}>Overall {overall}%</Badge> : undefined}
    >
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Framework</th>
              <th>Score</th>
              <th>Controls</th>
              <th>Audit Evidence</th>
              <th>Open Gaps</th>
            </tr>
          </thead>
          <tbody>
            {frameworks.map((framework) => {
              const openGaps = framework.controls.filter((control) => !control.satisfied);
              return (
              <tr key={framework.framework}>
                <td className="font-medium">
                  {framework.frameworkName}
                  <div className="text-xs text-muted">{framework.framework}</div>
                </td>
                <td>
                  <Badge variant={framework.postureScore >= 80 ? 'success' : framework.postureScore >= 50 ? 'warning' : 'danger'}>
                    {framework.postureScore}%
                  </Badge>
                </td>
                <td className="text-sm">
                  {framework.satisfiedControls}/{framework.totalControls} satisfied
                </td>
                <td className="text-sm">
                  {(framework.auditCounts?.totalCalls ?? 0).toLocaleString()} calls, {(framework.auditCounts?.blockedCalls ?? 0).toLocaleString()} blocked
                </td>
                <td className="text-sm">
                  {openGaps.length === 0
                    ? 'No open gaps'
                    : openGaps.slice(0, 2).map((control) => `${control.controlId}: ${control.gap ?? 'unsatisfied'}`).join('; ')}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ── Evidence ────────────────────────────────── */

const EVIDENCE_FRAMEWORKS = [
  { id: 'soc2', label: 'SOC 2' },
  { id: 'iso27001', label: 'ISO 27001' },
  { id: 'hipaa', label: 'HIPAA' },
  { id: 'pci-dss', label: 'PCI DSS' },
  { id: 'fedramp', label: 'FedRAMP' },
];

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function EvidenceView({ refreshKey }: { refreshKey: number }) {
  const [artifacts, setArtifacts] = useState<ComplianceEvidenceArtifact[]>([]);
  const [evidenceDir, setEvidenceDir] = useState<string | undefined>();
  const [hiddenLegacyCount, setHiddenLegacyCount] = useState(0);
  const [framework, setFramework] = useState('soc2');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchComplianceEvidence().catch((err: unknown) => ({
      artifacts: [],
      count: 0,
      evidenceDir: undefined,
      hiddenLegacyCount: 0,
      available: false,
      error: err instanceof Error ? err.message : 'Evidence library unavailable',
    }));
    setArtifacts(result.artifacts);
    setEvidenceDir(result.evidenceDir);
    setHiddenLegacyCount(result.hiddenLegacyCount ?? 0);
    setError(result.error ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const handleGenerate = async () => {
    setGenerating(true);
    setMessage(null);
    setError(null);
    const result = await generateComplianceEvidence(framework);
    setGenerating(false);
    if (!result.ok) {
      setError(result.error ?? 'Evidence generation failed');
      return;
    }
    setMessage(`Generated ${result.artifact?.filename ?? 'compliance evidence'}.`);
    await load();
  };

  return (
    <Card
      title="Evidence Library"
      subtitle="Generated compliance evidence from live policy and proxy audit data"
      actions={(
        <div className="flex items-center gap-2">
          <select
            className="input"
            value={framework}
            onChange={(event) => setFramework(event.target.value)}
            disabled={generating}
          >
            {EVIDENCE_FRAMEWORKS.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
          <Button variant="primary" size="sm" loading={generating} onClick={() => void handleGenerate()}>
            Generate Evidence
          </Button>
        </div>
      )}
    >
      {message && <p className="text-sm text-muted">{message}</p>}
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      {evidenceDir && (
        <p className="text-xs text-muted">
          Evidence directory: <code>{evidenceDir}</code>
        </p>
      )}
      {hiddenLegacyCount > 0 && (
        <p className="text-xs text-muted">
          Hidden legacy summary artifacts: {hiddenLegacyCount}. Generate new evidence to create full reports.
        </p>
      )}
      {loading ? (
        <p className="text-sm text-muted">Loading evidence artifacts…</p>
      ) : artifacts.length === 0 ? (
        <EmptyState
          title="No evidence artifacts"
          message="Generate evidence to create a compliance PDF from the current policy and audit trail."
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Artifact</th>
                <th>Type</th>
                <th>Detail</th>
                <th>Framework</th>
                <th>Generated</th>
                <th>Size</th>
                <th>Download</th>
                <th>Path</th>
              </tr>
            </thead>
            <tbody>
              {artifacts.map((artifact) => (
                <tr key={artifact.id}>
                  <td className="font-medium">{artifact.filename}</td>
                  <td><Badge variant="info">{artifact.kind}</Badge></td>
                  <td>
                    {artifact.detailLevel === 'detailed' ? (
                      <Badge variant="success">Full evidence</Badge>
                    ) : artifact.detailLevel === 'legacy-summary' ? (
                      <Badge variant="warning">Legacy summary</Badge>
                    ) : artifact.detailLevel === 'digest' ? (
                      <Badge variant="neutral">Digest</Badge>
                    ) : (
                      <span className="text-xs text-muted">Unknown</span>
                    )}
                  </td>
                  <td>{artifact.framework ?? '—'}</td>
                  <td className="text-xs text-muted">
                    {artifact.generatedAt ? new Date(artifact.generatedAt).toLocaleString() : '—'}
                  </td>
                  <td className="mono">{formatBytes(artifact.sizeBytes)}</td>
                  <td>
                    {artifact.downloadUrl ? (
                      <a className="btn btn-sm" href={artifact.downloadUrl} download>
                        Download
                      </a>
                    ) : (
                      <span className="text-xs text-muted">Unavailable</span>
                    )}
                  </td>
                  <td className="text-xs text-muted"><code>{artifact.path}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ── Container ───────────────────────────────── */

export function ComplianceCenter({ view, onViewChange, refreshKey }: Props) {
  return (
    <section aria-label="Compliance Center">
      <div className="page-header">
        <div>
          <h1>Compliance & Audit Readiness</h1>
          <p>Posture management, framework adherence, and evidence collection</p>
        </div>
      </div>

      <WorkspaceSubNav tabs={VIEW_TABS} active={view} onChange={onViewChange} />

      {view === 'overview' && <OverviewView refreshKey={refreshKey} />}
      {view === 'frameworks' && <FrameworksView refreshKey={refreshKey} />}
      {view === 'evidence' && <EvidenceView refreshKey={refreshKey} />}
    </section>
  );
}
