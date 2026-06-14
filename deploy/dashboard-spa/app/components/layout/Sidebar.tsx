'use client';

import { NAV_SECTIONS, WORKSPACE_CONFIG, DEFAULT_VIEW, type WorkspaceId } from '@/lib/workspace-nav';

interface SidebarProps {
  activeWorkspace: WorkspaceId;
  onNavigate: (id: WorkspaceId, view?: string) => void;
  unreadItems?: number;
}

const icons: Record<string, string> = {
  LayoutDashboard: '◉',
  Activity: '▸',
  Shield: '◆',
  FileCheck: '☰',
  DollarSign: '$',
  Server: '⬡',
  ClipboardCheck: '✓',
  Brain: '◎',
  Settings: '⚙',
  BookOpen: '📄',
};

function NavIcon({ name }: { name: string }) {
  return <span className="sidebar-icon" style={{ fontSize: 14 }}>{icons[name] || '○'}</span>;
}

export function Sidebar({ activeWorkspace, onNavigate, unreadItems }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <img src="/dashboard-spa/logo.jpeg" alt="mastyf.ai" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>
        <div className="sidebar-brand">
          <span className="sidebar-brand-name">mastyf.ai</span>
          <span className="sidebar-brand-version">Enterprise</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="sidebar-section">
            <span className="sidebar-section-label">{section.label}</span>
            {section.items.map((id) => {
              const config = WORKSPACE_CONFIG[id];
              const isActive = activeWorkspace === id;
              return (
                <button
                  key={id}
                  className={`sidebar-item${isActive ? ' active' : ''}`}
                  onClick={() => onNavigate(id, DEFAULT_VIEW[id])}
                  title={config.label}
                >
                  <NavIcon name={config.icon} />
                  <span className="sidebar-item-label">{config.label}</span>
                  {config.badge !== undefined && config.badge > 0 && (
                    <span className="sidebar-badge">{config.badge}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-footer-avatar">A</div>
        <div className="sidebar-footer-info">
          <div className="sidebar-footer-name">Admin</div>
          <div className="sidebar-footer-role">Security Operator</div>
        </div>
      </div>
    </aside>
  );
}
