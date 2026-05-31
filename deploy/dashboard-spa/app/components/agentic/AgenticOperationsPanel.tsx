'use client';

import { useEffect, useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { KpiCard } from '../dashboard/KpiCard';
import { fetchAgenticTasksDetail, guardianFetch } from '@/lib/guardian-api';
import { useAgenticDashboard } from './useAgenticDashboard';
import { useAgenticActions, AgenticInlineResult } from './AgenticActionContext';
import { AgenticIndustryPanel } from './AgenticIndustryPanel';
import { SandboxWizardPanel } from './SandboxWizardPanel';
import { ObservatoryPanel } from './ObservatoryPanel';
import { FederatedLearningPanel } from './FederatedLearningPanel';

type Props = { refreshKey?: number };

export function AgenticOperationsPanel({ refreshKey = 0 }: Props) {
  const { data, reload } = useAgenticDashboard(refreshKey);
  const { runAction, busy } = useAgenticActions();
  const [tasks, setTasks] = useState<Awaited<ReturnType<typeof fetchAgenticTasksDetail>>>(null);
  const [scheduler, setScheduler] = useState<Array<{ id: string; name: string; schedule: string; enabled: boolean; running: boolean; lastRun?: string }>>([]);

  useEffect(() => {
    void fetchAgenticTasksDetail().then(setTasks);
    void guardianFetch('/api/agentic/scheduler/status').then(async (r) => {
      if (!r.ok) return;
      const body = (await r.json()) as { tasks?: typeof scheduler };
      setScheduler(body.tasks ?? []);
    });
  }, [refreshKey, data?.generatedAt]);

  const stats = tasks?.stats ?? data?.kpis;

  return (
    <div className="agentic-panel space-y-4">
      <h2 className="text-xl font-bold">Operations</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Queued" value={stats && 'queued' in stats ? stats.queued : data?.kpis?.taskQueued ?? 0} />
        <KpiCard label="Running" value={stats && 'running' in stats ? stats.running : data?.kpis?.taskRunning ?? 0} />
        <KpiCard label="Completed" value={stats && 'completed' in stats ? stats.completed : 0} />
        <KpiCard label="Failed" value={stats && 'failed' in stats ? stats.failed : 0} />
      </div>

      <Card className="p-4">
        <h3 className="font-semibold mb-2">Pending approvals</h3>
        {(tasks?.pendingApprovals ?? []).length === 0 ? (
          <p className="hint">No pending human-in-the-loop approvals.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {tasks!.pendingApprovals.map((a) => (
              <li key={a.requestId} className="flex items-center justify-between gap-2 border-b border-gray-200 dark:border-gray-700 pb-2">
                <span>
                  <strong>{a.toolName}</strong> — {a.description}
                </span>
                <span className="btn-row">
                  <Button
                    size="sm"
                    disabled={!!busy}
                    onClick={() =>
                      void runAction(`approve-${a.requestId}`, 'Approve', `/api/agentic/tasks/${a.requestId}/approve`)
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!!busy}
                    onClick={() =>
                      void runAction(`deny-${a.requestId}`, 'Deny', `/api/agentic/tasks/${a.requestId}/deny`)
                    }
                  >
                    Deny
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <AgenticInlineResult actionId={`approve-${tasks?.pendingApprovals[0]?.requestId ?? 'x'}`} />
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-2">Scheduler</h3>
        {scheduler.length === 0 ? (
          <p className="hint">No scheduled agentic tasks registered.</p>
        ) : (
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th>Task</th>
                <th>Schedule</th>
                <th>Status</th>
                <th>Last run</th>
              </tr>
            </thead>
            <tbody>
              {scheduler.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.schedule}</td>
                  <td>{t.running ? 'running' : t.enabled ? 'enabled' : 'disabled'}</td>
                  <td>{t.lastRun ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <SandboxWizardPanel />
      <ObservatoryPanel />
      <FederatedLearningPanel refreshKey={refreshKey} />
      <AgenticIndustryPanel refreshKey={refreshKey} />
      <Button variant="secondary" size="sm" onClick={() => void reload()}>
        Refresh metrics
      </Button>
    </div>
  );
}
