'use client';

/** @deprecated Unmounted — use SecurityOperationsCenter Threat Detection view. See `_archive/README.md`. */

import { useEffect, useState } from 'react';
import { ThreatDiscoveryOverview } from './ThreatDiscoveryOverview';
import { ThreatLabWorkbench } from './ThreatLabWorkbench';
import { AutoResearchMonitor } from './AutoResearchMonitor';
import { ThreatArchitectureView } from './ThreatArchitectureView';
import { ThreatDiscoveryAutomation } from './ThreatDiscoveryAutomation';
import { useThreatDiscoveryJobs } from '@/lib/use-threat-discovery-jobs';
import RugPullSection from './RugPullSection';
import AutoCorpusPanel from './AutoCorpusPanel';
import type { AuthStatus } from '@/lib/mastyf-ai-api';

import type { ThreatLabContext } from './IncidentInvestigatorDrawer';

type SubTab = 'overview' | 'threat-lab' | 'auto-research' | 'rug-pull' | 'auto-corpus';

type Props = {
  roles?: string[];
  authStatus?: AuthStatus | null;
  refreshKey?: number;
  onAction?: (msg: string) => void;
  initialSubTab?: SubTab;
  externalView?: SubTab;
  threatLabContext?: ThreatLabContext | null;
  onClearThreatLabContext?: () => void;
};

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'threat-lab', label: 'Threat Lab' },
  { id: 'auto-research', label: 'Auto Research' },
  { id: 'rug-pull', label: 'Rug-Pull' },
  { id: 'auto-corpus', label: 'Auto-Corpus' },
];

export function ThreatDiscoveryPanel({
  roles,
  authStatus,
  refreshKey = 0,
  onAction,
  initialSubTab,
  externalView,
  threatLabContext,
  onClearThreatLabContext,
}: Props) {
  const [subTab, setSubTab] = useState<SubTab>(externalView || initialSubTab || 'overview');
  const {
    status,
    loading,
    error: loadError,
    refresh: load,
    setOptimisticRunning,
  } = useThreatDiscoveryJobs(refreshKey);

  useEffect(() => {
    if (externalView) setSubTab(externalView);
    else if (initialSubTab) setSubTab(initialSubTab);
  }, [initialSubTab, externalView]);

  const candidates = status?.threatLab.manifest?.candidates || [];
  const autoEntries = status?.autoCorpus.manifest?.entries || [];

  return (
    <section className="threat-discovery-hub" aria-label="Threat Discovery">
      <h2>Threat Discovery</h2>
      <p className="hint">
        LLM-driven threat discovery, self-sustaining auto research, and corpus audit.
      </p>

      {!externalView ? (
        <nav className="threat-discovery-tabs" aria-label="Threat Discovery sections">
          {SUB_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={subTab === t.id ? 'tab active' : 'tab'}
              onClick={() => setSubTab(t.id)}
            >
              {t.label}
            </button>
          ))}
          <button type="button" className="secondary btn-sm" disabled={loading} onClick={() => void load()}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </nav>
      ) : (
        <div className="btn-row">
          <button type="button" className="secondary btn-sm" disabled={loading} onClick={() => void load()}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      )}

      {loadError ? <p className="status status-error">{loadError}</p> : null}

      {subTab === 'overview' ? (
        <>
          <ThreatDiscoveryOverview
            status={status}
            loading={loading}
            loadError={loadError}
            roles={roles}
            onRunStarted={onAction}
            onRefresh={() => void load()}
            onOptimisticStart={setOptimisticRunning}
          />
          <details className="security-manifest-detail">
            <summary>Automation and scheduler details</summary>
            <ThreatDiscoveryAutomation />
          </details>
          <details className="security-manifest-detail">
            <summary>Threat architecture reference</summary>
            <ThreatArchitectureView />
          </details>
        </>
      ) : null}

      {subTab === 'threat-lab' ? (
        <ThreatLabWorkbench
          candidates={candidates}
          autoEntries={autoEntries}
          roles={roles}
          preloadedContext={threatLabContext}
          manifestMeta={{
            timestamp: status?.threatLab.manifest?.timestamp,
            mode: status?.threatLab.manifest?.mode,
            llmModel: status?.threatLab.manifest?.llmModel,
            llmUsed: status?.threatLab.manifest?.llmUsed,
            skipped: status?.threatLab.manifest?.skipped,
            runNote: status?.threatLab.manifest?.runNote,
          }}
          onRefresh={() => void load()}
          onClearContext={onClearThreatLabContext}
          onRunStarted={onAction}
        />
      ) : null}

      {subTab === 'auto-research' ? (
        <AutoResearchMonitor entries={autoEntries} status={status} />
      ) : null}

      {subTab === 'rug-pull' ? <RugPullSection /> : null}

      {subTab === 'auto-corpus' ? <AutoCorpusPanel /> : null}

    </section>
  );
}
