'use client';

import { type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { WORKSPACE_CONFIG, viewLabel, type WorkspaceId } from '@/lib/workspace-nav';

interface EnterpriseLayoutProps {
  children: ReactNode;
  activeWorkspace: WorkspaceId;
  activeView?: string;
  onNavigate: (id: WorkspaceId, view?: string) => void;
  topbarExtra?: ReactNode;
  statusBar?: ReactNode;
  connection?: 'live' | 'degraded' | 'offline' | 'connecting';
  wsConnected?: boolean;
  wsEventCount?: number;
  onRefresh?: () => void;
  onDownloadReport?: () => void;
  reportLoading?: boolean;
}

const connectionLabels: Record<string, string> = {
  live: 'Live',
  degraded: 'Degraded',
  offline: 'Offline',
  connecting: 'Connecting…',
};

export function EnterpriseLayout({
  children,
  activeWorkspace,
  activeView,
  onNavigate,
  topbarExtra,
  statusBar,
  connection = 'connecting',
  wsConnected,
  wsEventCount,
  onRefresh,
}: EnterpriseLayoutProps) {
  const wsConfig = WORKSPACE_CONFIG[activeWorkspace];
  const pageTitle = wsConfig?.label || 'Dashboard';
  const pageSubtitle = activeView ? viewLabel(activeWorkspace, activeView) : '';

  return (
    <div className="shell">
      <Sidebar
        activeWorkspace={activeWorkspace}
        onNavigate={onNavigate}
      />

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <h1 className="topbar-title">{pageTitle}</h1>
            {pageSubtitle && (
              <div className="topbar-breadcrumb">
                <span className="topbar-breadcrumb-sep">/</span>
                <span>{pageSubtitle}</span>
              </div>
            )}
          </div>

          <div className="topbar-right">
            {topbarExtra}

            <div className="topbar-divider" />

            <span className={`connection-indicator ${connection}`}>
              <span className={`status-dot ${connection}`} />
              {connectionLabels[connection]}
            </span>

            {onRefresh && (
              <button className="btn btn-ghost btn-sm" onClick={onRefresh} title="Refresh data">
                ↻
              </button>
            )}
          </div>
        </header>

        {statusBar && (
          <div className="topbar-status">
            {statusBar}
            {wsEventCount !== undefined && wsEventCount > 0 && (
              <span style={{ marginLeft: 'auto' }}>
                {wsEventCount} events
              </span>
            )}
          </div>
        )}

        <main className="content-area">
          <div className="content-inner">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
