'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchThreatDiscoveryStatus, type ThreatDiscoveryStatus } from '@/lib/guardian-api';
import { ThreatDiscoveryOverview } from './ThreatDiscoveryOverview';
import { ThreatLabWorkbench } from './ThreatLabWorkbench';
import { AutoResearchMonitor } from './AutoResearchMonitor';
import { ThreatArchitectureView } from './ThreatArchitectureView';
import { ThreatDiscoveryAutomation } from './ThreatDiscoveryAutomation';
import { ProUpgradeBanner } from './ProUpgradeBanner';
import type { AuthStatus } from '@/lib/guardian-api';

import type { ThreatLabContext } from './IncidentInvestigatorDrawer';

type SubTab = 'overview' | 'threat-lab' | 'auto-research' | 'automation' | 'architecture';

type Props = {
  roles?: string[];
  authStatus?: AuthStatus | null;
  refreshKey?: number;
  onAction?: (msg: string) => void;
  initialSubTab?: SubTab;
  threatLabContext?: ThreatLabContext | null;
  onClearThreatLabContext?: () => void;
};

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'threat-lab', label: 'Threat Lab' },
  { id: 'auto-research', label: 'Auto Research' },
  { id: 'automation', label: 'Automation' },
  { id: 'architecture', label: 'Architecture' },
];

export function ThreatDiscoveryPanel({
  roles,
  authStatus,
  refreshKey = 0,
  onAction,
  initialSubTab,
  threatLabContext,
  onClearThreatLabContext,
}: Props) {
  const [subTab, setSubTab] = useState<SubTab>(initialSubTab || 'overview');
  const [status, setStatus] = useState<ThreatDiscoveryStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (initialSubTab) setSubTab(initialSubTab);
  }, [initialSubTab]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { status: data, error } = await fetchThreatDiscoveryStatus();
      setStatus(data);
      if (error) setLoadError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const candidates = status?.threatLab.manifest?.candidates || [];
  const autoEntries = status?.autoCorpus.manifest?.entries || [];

  return (
    <section className="threat-discovery-hub" aria-label="Threat Discovery">
      <h2>Threat Discovery</h2>
      <p className="hint">
        LLM-driven threat discovery, self-sustaining auto research, and corpus audit — Pro feature.
      </p>

      <ProUpgradeBanner authStatus={authStatus ?? null} />

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

      {loadError ? <p className="status status-error">{loadError}</p> : null}

      {subTab === 'overview' ? (
        <ThreatDiscoveryOverview
          status={status}
          loading={loading}
          loadError={loadError}
          roles={roles}
          onRunStarted={onAction}
          onRefresh={() => void load()}
        />
      ) : null}

      {subTab === 'threat-lab' ? (
        <ThreatLabWorkbench
          candidates={candidates}
          roles={roles}
          preloadedContext={threatLabContext}
          manifestMeta={{
            timestamp: status?.threatLab.manifest?.timestamp,
            mode: status?.threatLab.manifest?.mode,
            llmModel: status?.threatLab.manifest?.llmModel,
            llmUsed: status?.threatLab.manifest?.llmUsed,
          }}
          onRefresh={() => void load()}
        />
      ) : null}

      {subTab === 'auto-research' ? (
        <AutoResearchMonitor entries={autoEntries} status={status} />
      ) : null}

      {subTab === 'automation' ? <ThreatDiscoveryAutomation /> : null}
      {subTab === 'architecture' ? <ThreatArchitectureView /> : null}
    </section>
  );
}
