'use client';

import {
  Activity,
  BookOpen,
  ClipboardCheck,
  Coins,
  FileCheck,
  FlaskConical,
  LayoutDashboard,
  ScrollText,
  Server,
  Settings,
  Shield,
  type LucideIcon,
} from 'lucide-react';
import { DEFAULT_VIEW, TOP_TABS, WORKSPACE_CONFIG, tabForWorkspace, type WorkspaceId } from '@/lib/workspace-nav';

const ICONS: Partial<Record<WorkspaceId, LucideIcon>> = {
  overview: LayoutDashboard,
  activity: Activity,
  security: Shield,
  policy: FileCheck,
  logs: ScrollText,
  servers: Server,
  cost: Coins,
  compliance: ClipboardCheck,
  settings: Settings,
  help: BookOpen,
};

/** Pages people look for by name: shown as their own entry, whichever page is open. */
const PINNED: Partial<Record<WorkspaceId, { view: string; label: string; icon: LucideIcon }>> = {
  security: { view: 'threats', label: 'Threat Lab', icon: FlaskConical },
};

/** Left navigation for Security Center and Engineering, grouped like the Shield app. */
export function Sidebar({
  activeWorkspace,
  activeView,
  onNavigate,
}: {
  activeWorkspace: WorkspaceId;
  activeView?: string;
  onNavigate: (id: WorkspaceId, view?: string) => void;
}) {
  const tab = TOP_TABS.find((t) => t.id === tabForWorkspace(activeWorkspace));
  if (!tab || tab.id === 'home') return null;
  const other = TOP_TABS.find((t) => t.id !== tab.id && t.id !== 'home');
  return (
    <aside className="side" aria-label={`${tab.label} pages`}>
      {tab.groups.map((g) => (
        <div key={g.label} className="side-group">
          <span className="side-label">{g.label}</span>
          {g.items.map((id) => {
            const Icon = ICONS[id] ?? LayoutDashboard;
            const active = id === activeWorkspace;
            const pin = PINNED[id];
            const pinActive = active && !!pin && activeView === pin.view;
            const views = (WORKSPACE_CONFIG[id].views ?? []).filter((v) => v.id !== pin?.view);
            const current = activeView ?? DEFAULT_VIEW[id];
            return (
              <div key={id} className="side-entry">
                <button
                  type="button"
                  className={`side-item${active && !pinActive ? ' active' : ''}`}
                  aria-current={active && views.length === 0 ? 'page' : undefined}
                  aria-expanded={views.length > 0 ? active : undefined}
                  onClick={() => onNavigate(id, DEFAULT_VIEW[id])}
                >
                  <Icon size={16} aria-hidden="true" />
                  {WORKSPACE_CONFIG[id].label}
                </button>
                {active && !pinActive && views.length > 1 && (
                  <div className="side-sub" role="list">
                    {views.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        role="listitem"
                        className={`side-subitem${v.id === current ? ' active' : ''}`}
                        aria-current={v.id === current ? 'page' : undefined}
                        onClick={() => onNavigate(id, v.id)}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                )}
                {pin && (
                  <button
                    type="button"
                    className={`side-item${pinActive ? ' active' : ''}`}
                    aria-current={pinActive ? 'page' : undefined}
                    onClick={() => onNavigate(id, pin.view)}
                  >
                    <pin.icon size={16} aria-hidden="true" />
                    {pin.label}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {other && (
        <button
          type="button"
          className="side-switch"
          onClick={() => {
            const first = other.groups[0].items[0];
            onNavigate(first, DEFAULT_VIEW[first]);
          }}
        >
          Open {other.label}
        </button>
      )}
    </aside>
  );
}
