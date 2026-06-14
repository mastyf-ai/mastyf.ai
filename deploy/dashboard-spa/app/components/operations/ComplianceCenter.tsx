'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchComplianceReport,
  fetchPlanComplianceAudit,
  fetchContinuousAssuranceReport,
  fetchCertificationRegistry,
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
  const [assurance, setAssurance] = useState<ContinuousAssuranceReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const a = await fetchContinuousAssuranceReport().catch(() => null);
    if (a) setAssurance(a);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  if (loading) return <p className="text-sm text-muted">Loading frameworks…</p>;

  if (!assurance?.controls || Object.keys(assurance.controls).length === 0) {
    return <EmptyState title="No frameworks" message="No compliance frameworks are configured" />;
  }

  return (
    <Card title="Compliance Frameworks" subtitle="Active control frameworks and their status">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Control</th>
              <th>Status</th>
              <th>Category</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(assurance.controls).map(([key, control]: [string, any]) => (
              <tr key={key}>
                <td className="font-medium">{control.name || key}</td>
                <td>
                  <Badge variant={control.status === 'pass' ? 'success' : control.status === 'fail' ? 'danger' : 'warning'}>
                    {control.status || 'unknown'}
                  </Badge>
                </td>
                <td className="text-sm">{control.category || '—'}</td>
                <td className="text-sm">{control.evidenceCount ?? 0} items</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ── Evidence ────────────────────────────────── */

function EvidenceView() {
  return (
    <Card title="Evidence Library">
      <EmptyState
        title="Evidence management"
        message="Upload and manage compliance evidence artifacts. Automated evidence collection will be available in a future release."
      />
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
      {view === 'evidence' && <EvidenceView />}
    </section>
  );
}
