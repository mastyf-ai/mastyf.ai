'use client';

import { type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { TopNav, type Connection } from './TopNav';
import { PageTransition } from '../ui/motion';
import { Sidebar } from './Sidebar';
import { WORKSPACE_CONFIG, viewLabel, type WorkspaceId } from '@/lib/workspace-nav';

interface EnterpriseLayoutProps {
  children: ReactNode;
  activeWorkspace: WorkspaceId;
  activeView?: string;
  onNavigate: (id: WorkspaceId, view?: string) => void;
  topbarExtra?: ReactNode;
  statusBar?: ReactNode;
  connection?: Connection;
  wsConnected?: boolean;
  wsEventCount?: number;
  onRefresh?: () => void;
  onDownloadReport?: () => void;
  reportLoading?: boolean;
}

const CONNECTION: Record<Connection, { text: string; title: string }> = {
  live: { text: 'Live', title: 'Connected, with updates streaming in' },
  degraded: { text: 'Connected', title: 'Connected. Live updates are off, so data refreshes every 30 seconds' },
  offline: { text: 'Offline', title: 'The Mastyf service on this computer is not answering' },
  connecting: { text: 'Connecting', title: 'Connecting to the Mastyf service' },
};

/** Page frame: Shield-style header; Home is full width, other sections get the grouped sidebar. */
export function EnterpriseLayout({
  children,
  activeWorkspace,
  activeView,
  onNavigate,
  topbarExtra,
  statusBar,
  connection = 'connecting',
  onRefresh,
}: EnterpriseLayoutProps) {
  const isHome = activeWorkspace === 'dashboard';
  const title = WORKSPACE_CONFIG[activeWorkspace]?.label || 'Home';
  const subtitle = activeView ? viewLabel(activeWorkspace, activeView) : '';
  const conn = CONNECTION[connection];

  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to content</a>
      <TopNav activeWorkspace={activeWorkspace} onNavigate={onNavigate} connection={connection} />

      {isHome ? (
        <main className="page page-home" id="main">
          <PageTransition id={`${activeWorkspace}/${activeView ?? ''}`} className="content-inner">{children}</PageTransition>
        </main>
      ) : (
        <div className="shell-body">
          <Sidebar activeWorkspace={activeWorkspace} activeView={activeView} onNavigate={onNavigate} />
          <div className="shell-main">
            <div className="page-head">
              <div className="page-head-title">
                <span>{title}</span>
                {subtitle && subtitle !== title && <span className="page-head-sub">{subtitle}</span>}
              </div>
              <div className="page-tools">
                {topbarExtra}
                <span className={`live-pill ${connection}`} title={conn.title}>{conn.text}</span>
                {onRefresh && (
                  <button type="button" className="nav-icon" onClick={onRefresh} title="Refresh now" aria-label="Refresh now">
                    <RefreshCw size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
            {statusBar && <div className="page-status">{statusBar}</div>}
            <main className="page" id="main">
              <PageTransition id={`${activeWorkspace}/${activeView ?? ''}`} className="content-inner">{children}</PageTransition>
            </main>
          </div>
        </div>
      )}
      <footer className="app-foot">Mastyf</footer>
    </div>
  );
}
