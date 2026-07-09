'use client';

import { useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard,
  Activity,
  Shield,
  FileCheck,
  DollarSign,
  Server,
  ClipboardCheck,
  Brain,
  Settings,
  ScrollText,
  BookOpen,
  Circle,
  Power,
  LogOut,
  RotateCcw,
  Users,
} from 'lucide-react';
import { NAV_SECTIONS, WORKSPACE_CONFIG, DEFAULT_VIEW, type WorkspaceId } from '@/lib/workspace-nav';
import { BrandLogo } from '../ui/BrandLogo';
import { useAuthSession } from '../AuthSessionContext';

interface SidebarProps {
  activeWorkspace: WorkspaceId;
  onNavigate: (id: WorkspaceId, view?: string) => void;
  unreadItems?: number;
}

const icons: Record<string, typeof LayoutDashboard> = {
  LayoutDashboard,
  Activity,
  Shield,
  FileCheck,
  DollarSign,
  Server,
  ClipboardCheck,
  Brain,
  Settings,
  ScrollText,
  BookOpen,
};

function NavIcon({ name }: { name: string }) {
  const Icon = icons[name] || Circle;
  return <Icon className="sidebar-icon" size={16} strokeWidth={2} />;
}

function initials(label: string): string {
  const parts = label.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function Sidebar({ activeWorkspace, onNavigate, unreadItems }: SidebarProps) {
  const { status, tenant, onLogout, onRestartSession } = useAuthSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [menuOpen]);

  const displayName = status?.identity || 'Not signed in';
  const roleLabel = status?.roles?.length ? status.roles.join(', ') : status?.dashboardRole || 'viewer';
  const tenantLabel = tenant || 'default';

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <BrandLogo />
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
        <div className="sidebar-footer-avatar">{initials(displayName)}</div>
        <div className="sidebar-footer-info">
          <div className="sidebar-footer-name" title={displayName}>{displayName}</div>
          <div className="sidebar-footer-role" title={`${roleLabel} · ${tenantLabel}`}>
            {roleLabel} · {tenantLabel}
          </div>
        </div>

        <div className="sidebar-power" ref={menuRef}>
          <button
            className="sidebar-power-btn"
            onClick={() => setMenuOpen((v) => !v)}
            title="Session options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <Power size={15} strokeWidth={2} />
          </button>

          {menuOpen && (
            <div className="sidebar-power-menu" role="menu">
              <button
                className="sidebar-power-menu-item"
                role="menuitem"
                onClick={() => { setMenuOpen(false); void onRestartSession(); }}
              >
                <RotateCcw size={14} strokeWidth={2} />
                Restart Session
              </button>
              <button
                className="sidebar-power-menu-item"
                role="menuitem"
                onClick={() => { setMenuOpen(false); void onLogout(); }}
              >
                <Users size={14} strokeWidth={2} />
                Switch User
              </button>
              <div className="sidebar-power-menu-divider" />
              <button
                className="sidebar-power-menu-item danger"
                role="menuitem"
                onClick={() => { setMenuOpen(false); void onLogout(); }}
              >
                <LogOut size={14} strokeWidth={2} />
                Log Out
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
