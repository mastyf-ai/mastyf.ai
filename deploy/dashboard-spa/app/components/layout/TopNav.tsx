'use client';

import { withCrossfade } from '../ui/motion';
import { useEffect, useRef, useState } from 'react';
import { LogOut, Moon, RotateCcw, Search, Sun, User, Users } from 'lucide-react';
import { DEFAULT_VIEW, TOP_TABS, tabForWorkspace, type TopTabId, type WorkspaceId } from '@/lib/workspace-nav';
import { BrandLogo } from '../ui/BrandLogo';
import { useAuthSession } from '../AuthSessionContext';
import { CommandPalette } from './CommandPalette';

export type Connection = 'live' | 'degraded' | 'offline' | 'connecting';

function useTheme(): ['light' | 'dark', () => void] {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  useEffect(() => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  }, []);
  const toggle = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    withCrossfade(() => document.documentElement.setAttribute('data-theme', next));
    try {
      localStorage.setItem('mastyf-theme', next);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
    setTheme(next);
  };
  return [theme, toggle];
}

/** The local time, like the Shield app's header clock. */
function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  if (!now) return null;
  return (
    <span className="nav-clock" aria-label="Local time">
      <strong>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</strong>
      <span>{now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</span>
    </span>
  );
}

function initials(label: string): string {
  const parts = label.trim().split(/[\s._@-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const FIRST_OF: Record<TopTabId, WorkspaceId> = {
  home: 'dashboard',
  'security-center': 'activity',
  engineering: 'overview',
};

type Props = {
  activeWorkspace: WorkspaceId;
  onNavigate: (id: WorkspaceId, view?: string) => void;
  connection: Connection;
};

export function TopNav({ activeWorkspace, onNavigate }: Props) {
  const { status, tenant, onLogout, onRestartSession } = useAuthSession();
  const [theme, toggleTheme] = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeTab = tabForWorkspace(activeWorkspace);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const name = status?.identity || 'Signed in';
  const role = status?.roles?.length ? status.roles.join(', ') : status?.dashboardRole || 'viewer';
  const paid = status?.plan === 'paid';
  const upgradeUrl = status?.upgradeUrl || null;
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

  return (
    <header className="nav">
      <button type="button" className="nav-brand" onClick={() => onNavigate('dashboard')} aria-label="Mastyf home">
        <BrandLogo size={26} wordmark />
      </button>

      <nav className="nav-tabs" aria-label="Sections">
        {TOP_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`nav-tab${activeTab === t.id ? ' active' : ''}`}
            aria-current={activeTab === t.id ? 'page' : undefined}
            onClick={() => {
              const ws = FIRST_OF[t.id];
              onNavigate(ws, DEFAULT_VIEW[ws]);
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <button type="button" className="nav-search" onClick={() => setPaletteOpen(true)} aria-label="Search the dashboard">
        <Search size={14} aria-hidden="true" />
        <span>Search</span>
        <kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>

      <div className="nav-right">
        {paid ? (
          <span className="nav-plan paid" title="Your Shield plan is active">Shield</span>
        ) : (
          upgradeUrl && (
            <a className="btn btn-primary btn-sm nav-upgrade" href={upgradeUrl} target="_blank" rel="noopener noreferrer">
              Get Shield
            </a>
          )
        )}
        <Clock />
        <button
          type="button"
          className="nav-icon"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <div className="nav-account" ref={menuRef}>
          <button
            type="button"
            className="nav-avatar"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Account: ${name}`}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {initials(name)}
          </button>
          {menuOpen && (
            <div className="menu menu-right" role="menu">
              <div className="menu-head">
                <strong>{name}</strong>
                <span>{role} in {tenant || 'default'}</span>
                <span className="menu-plan">{paid ? 'Shield plan' : 'Free plan'}</span>
              </div>
              <button type="button" role="menuitem" className="menu-item" onClick={() => { setMenuOpen(false); onNavigate('settings', 'profile'); }}>
                <User size={14} aria-hidden="true" /> Your profile
              </button>
              <button type="button" role="menuitem" className="menu-item" onClick={() => { setMenuOpen(false); void onRestartSession(); }}>
                <RotateCcw size={14} aria-hidden="true" /> Reload session
              </button>
              <button type="button" role="menuitem" className="menu-item" onClick={() => { setMenuOpen(false); void onLogout(); }}>
                <Users size={14} aria-hidden="true" /> Switch user
              </button>
              <div className="menu-sep" />
              <button type="button" role="menuitem" className="menu-item danger" onClick={() => { setMenuOpen(false); void onLogout(); }}>
                <LogOut size={14} aria-hidden="true" /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onNavigate={(id, view) => { setPaletteOpen(false); onNavigate(id, view); }}
        />
      )}
    </header>
  );
}
