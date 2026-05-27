'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchComplianceReport,
  fetchSemanticOutcomes,
  fetchShadowRedTeamReport,
  fetchSignatureHints,
  fetchSupplyChainGraph,
  fetchTribunalReport,
  type SemanticOutcome,
  type TribunalReport,
} from '@/lib/guardian-api';
import { TRIBUNAL_BATCH_LIMIT } from '@/lib/tribunal-config';
import { DashboardSection } from './dashboard/DashboardSection';
import { TenantLoraPanel } from './TenantLoraPanel';
import { EnterpriseSecurityIntelSection } from './EnterpriseSecurityIntelSection';
import { TribunalSummaryCard } from './TribunalSummaryCard';
import { ComplianceBriefingCard } from './ComplianceBriefingCard';
import { IncidentInvestigatorDrawer, type ThreatLabContext } from './IncidentInvestigatorDrawer';
import { hasPermission } from '@/lib/dashboard-roles';

type Props = {
  roles?: string[];
  refreshTick?: number;
  onAction?: (msg: string) => void;
  onOpenThreatLab?: (ctx: ThreatLabContext) => void;
  onOpenPolicyCounterfactual?: () => void;
};

export function EnterpriseAiPanel({
  roles,
  refreshTick = 0,
  onAction,
  onOpenThreatLab,
  onOpenPolicyCounterfactual,
}: Props) {
  const canAi = hasPermission(roles, 'ai');
  const [supplyChain, setSupplyChain] = useState<Record<string, unknown> | null>(null);
  const [shadowRedTeam, setShadowRedTeam] = useState<Record<string, unknown> | null>(null);
  const [signatureHints, setSignatureHints] = useState<Record<string, unknown> | null>(null);
  const [tribunal, setTribunal] = useState<TribunalReport | null>(null);
  const [compliance, setCompliance] = useState<Record<string, unknown> | null>(null);
  const [semantic, setSemantic] = useState<SemanticOutcome[]>([]);
  const [investigateId, setInvestigateId] = useState<string | null>(null);
  const [tribunalLoading, setTribunalLoading] = useState(false);

  const refresh = useCallback(async () => {
    const [sc, shadow, hints, trib, comp, semResp] = await Promise.all([
      fetchSupplyChainGraph(),
      fetchShadowRedTeamReport(),
      fetchSignatureHints(),
      fetchTribunalReport(TRIBUNAL_BATCH_LIMIT),
      fetchComplianceReport(7),
      fetchSemanticOutcomes(),
    ]);
    setSupplyChain(sc);
    setShadowRedTeam(shadow);
    setSignatureHints(hints);
    setTribunal(trib);
    setCompliance(comp);
    setSemantic(semResp.records);
  }, []);

  const runTribunalOnly = useCallback(async () => {
    setTribunalLoading(true);
    try {
      const trib = await fetchTribunalReport(TRIBUNAL_BATCH_LIMIT);
      setTribunal(trib);
      const n = trib?.debatedCount ?? 0;
      const remaining = trib?.remainingEligible ?? 0;
      if (n > 0) {
        onAction?.(
          remaining > 0
            ? `Tribunal: ${n} debate(s) · ${remaining} remaining — run next batch`
            : `Tribunal completed: ${n} debate(s) — queue empty`,
        );
      } else {
        onAction?.('Tribunal ran — no uncertain flags in queue');
      }
    } finally {
      setTribunalLoading(false);
    }
  }, [onAction]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshTick]);

  const debatedCount = Number(tribunal?.debatedCount ?? 0);
  const hintCount = ((signatureHints?.hints as unknown[]) ?? []).length;
  const supplyNodes = ((supplyChain?.graph as { nodes?: unknown[] })?.nodes ?? []).length;

  return (
    <div className="enterprise-ai-panel">
      <DashboardSection
        title="Enterprise AI"
        subtitle="Tier 1/2 intelligence — LoRA, supply chain, federation, tribunal, compliance, and investigation"
      >
        <div className="btn-row">
          <button type="button" className="secondary" onClick={() => void refresh()}>
            Refresh
          </button>
          {onOpenPolicyCounterfactual ? (
            <button type="button" className="secondary" onClick={onOpenPolicyCounterfactual}>
              Policy counterfactual (What-if)
            </button>
          ) : null}
        </div>

        <div className="enterprise-ai-kpi-row">
          <div className="enterprise-ai-kpi">
            <span className="enterprise-ai-kpi-value">{supplyNodes}</span>
            <span className="enterprise-ai-kpi-label">Supply chain nodes</span>
          </div>
          <div className="enterprise-ai-kpi" title="Debates from last tribunal run (uncertain semantic flags)">
            <span className="enterprise-ai-kpi-value">{debatedCount}</span>
            <span className="enterprise-ai-kpi-label">Tribunal debates (last run)</span>
          </div>
          <div className="enterprise-ai-kpi">
            <span className="enterprise-ai-kpi-value">{hintCount}</span>
            <span className="enterprise-ai-kpi-label">Fleet hints</span>
          </div>
          <div className="enterprise-ai-kpi">
            <span className="enterprise-ai-kpi-value">{semantic.length}</span>
            <span className="enterprise-ai-kpi-label">Semantic audits</span>
          </div>
        </div>

        <div className="enterprise-ai-grid">
          <TenantLoraPanel roles={roles} refreshTick={refreshTick} onAction={onAction} />
          <TribunalSummaryCard
            tribunal={tribunal}
            tribunalLoading={tribunalLoading}
            onRunTribunal={() => void runTribunalOnly()}
            onInvestigateRecord={canAi ? (id) => setInvestigateId(id) : undefined}
          />
          <ComplianceBriefingCard compliance={compliance} />
          <EnterpriseSecurityIntelSection
            supplyChain={supplyChain}
            shadowRedTeam={shadowRedTeam}
            signatureHints={signatureHints}
          />

          <article className="enterprise-ai-card enterprise-ai-card-wide">
            <h3>Incident investigator</h3>
            <p className="hint">Agent intent graph + kill-chain narrative from session flow and semantic audit records</p>
            {semantic.length === 0 ? (
              <p className="muted">
                No semantic audit records — enable GUARDIAN_SEMANTIC_ASYNC and route MCP traffic through Guardian.
              </p>
            ) : (
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Tool</th>
                    <th>Confidence</th>
                    <th>Label</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {semantic.slice(0, 10).map((r) => (
                    <tr key={r.id}>
                      <td>{r.toolName || '—'}</td>
                      <td>{r.confidence != null ? `${(r.confidence * 100).toFixed(0)}%` : '—'}</td>
                      <td>{r.label || '—'}</td>
                      <td>
                        {canAi ? (
                          <button type="button" className="secondary btn-sm" onClick={() => setInvestigateId(r.id)}>
                            Investigate
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
        </div>
      </DashboardSection>

      {investigateId ? (
        <IncidentInvestigatorDrawer
          triggerId={investigateId}
          onClose={() => setInvestigateId(null)}
          onOpenThreatLab={onOpenThreatLab}
        />
      ) : null}
    </div>
  );
}
