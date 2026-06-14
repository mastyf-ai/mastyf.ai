export type WorkspaceId =
  | 'dashboard'
  | 'activity'
  | 'security'
  | 'policy'
  | 'cost'
  | 'servers'
  | 'compliance'
  | 'agentic'
  | 'settings'
  | 'help';

export type ActivityView = 'realtime' | 'audit';
export type SecurityView = 'overview' | 'threats' | 'intel' | 'quarantine';
export type PolicyView = 'rules' | 'editor' | 'test' | 'history';
export type CostView = 'overview' | 'breakdown' | 'budgets';
export type ServersView = 'overview' | 'health' | 'certifications';
export type ComplianceView = 'overview' | 'frameworks' | 'evidence';
// Legacy workspace IDs kept for backward compatibility with existing panels
export type LegacyWorkspaceId = 'home' | 'operations' | 'threats';
export type AgenticView = 'overview' | 'learning' | 'red-team' | 'prediction' | 'trust' | 'biometrics' | 'threats' | 'policy' | 'operations' | 'audit' | 'tools';
export type SettingsView = 'general' | 'tenants' | 'integrations' | 'admin';

export const WORKSPACE_CONFIG: Record<WorkspaceId, {
  label: string;
  icon: string;
  badge?: number;
  views?: Array<{ id: string; label: string }>;
}> = {
  dashboard: {
    label: 'Dashboard',
    icon: 'LayoutDashboard',
  },
  activity: {
    label: 'Activity',
    icon: 'Activity',
    views: [
      { id: 'realtime', label: 'Live Feed' },
      { id: 'audit', label: 'Audit Trail' },
    ],
  },
  security: {
    label: 'Security',
    icon: 'Shield',
    badge: 0,
    views: [
      { id: 'overview', label: 'Posture Overview' },
      { id: 'threats', label: 'Threat Detection' },
      { id: 'intel', label: 'Threat Intel' },
      { id: 'quarantine', label: 'Quarantine' },
    ],
  },
  policy: {
    label: 'Policy',
    icon: 'FileCheck',
    views: [
      { id: 'rules', label: 'Active Rules' },
      { id: 'editor', label: 'Policy Editor' },
      { id: 'test', label: 'Test & Simulate' },
      { id: 'history', label: 'Version History' },
    ],
  },
  cost: {
    label: 'Cost',
    icon: 'DollarSign',
    views: [
      { id: 'overview', label: 'Cost Overview' },
      { id: 'breakdown', label: 'Breakdown' },
      { id: 'budgets', label: 'Budgets' },
    ],
  },
  servers: {
    label: 'MCP Servers',
    icon: 'Server',
    views: [
      { id: 'overview', label: 'Inventory' },
      { id: 'health', label: 'Health & Performance' },
      { id: 'certifications', label: 'Certifications' },
    ],
  },
  compliance: {
    label: 'Compliance',
    icon: 'ClipboardCheck',
    views: [
      { id: 'overview', label: 'Compliance Posture' },
      { id: 'frameworks', label: 'Frameworks' },
      { id: 'evidence', label: 'Evidence' },
    ],
  },
  agentic: {
    label: 'AI Operations',
    icon: 'Brain',
    views: [
      { id: 'overview', label: 'Overview' },
      { id: 'learning', label: 'ML Learning' },
      { id: 'red-team', label: 'Red Team' },
      { id: 'prediction', label: 'Threat Forecast' },
      { id: 'trust', label: 'Trust & Reputation' },
      { id: 'biometrics', label: 'Behavioral' },
    ],
  },
  settings: {
    label: 'Settings',
    icon: 'Settings',
    views: [
      { id: 'general', label: 'General' },
      { id: 'tenants', label: 'Tenants' },
      { id: 'integrations', label: 'Integrations' },
      { id: 'admin', label: 'Administration' },
    ],
  },
  help: {
    label: 'Help',
    icon: 'BookOpen',
  },
};

export const NAV_SECTIONS: Array<{
  label: string;
  items: WorkspaceId[];
}> = [
  { label: 'Overview', items: ['dashboard'] },
  { label: 'Security', items: ['activity', 'security'] },
  { label: 'Governance', items: ['policy', 'cost', 'servers'] },
  { label: 'Assurance', items: ['compliance'] },
  { label: 'Intelligence', items: ['agentic'] },
  { label: 'System', items: ['settings', 'help'] },
];

export const DEFAULT_WORKSPACE: WorkspaceId = 'dashboard';
export const DEFAULT_VIEW: Partial<Record<WorkspaceId, string>> = {
  dashboard: undefined,
  activity: 'realtime',
  security: 'overview',
  policy: 'rules',
  cost: 'overview',
  servers: 'overview',
  compliance: 'overview',
  agentic: 'overview',
  settings: 'general',
  help: undefined,
};

export interface NavState {
  workspace: WorkspaceId;
  view?: string;
  topic?: string;
}

export function parseNavFromUrl(search: string): NavState {
  const params = new URLSearchParams(search);
  const ws = (params.get('workspace') || DEFAULT_WORKSPACE) as WorkspaceId;
  const view = params.get('view') || DEFAULT_VIEW[ws];
  const topic = params.get('topic') || undefined;
  return { workspace: ws in WORKSPACE_CONFIG ? ws : DEFAULT_WORKSPACE, view, topic };
}

export function syncNavToUrl(state: NavState): void {
  const params = new URLSearchParams();
  params.set('workspace', state.workspace);
  if (state.view && state.view !== DEFAULT_VIEW[state.workspace]) {
    params.set('view', state.view);
  }
  if (state.topic) {
    params.set('topic', state.topic);
  }
  const qs = params.toString();
  const url = qs ? `?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', url);
}

export function workspaceLabel(id: WorkspaceId): string {
  return WORKSPACE_CONFIG[id]?.label || id;
}

export function viewLabel(ws: WorkspaceId, viewId?: string): string {
  if (!viewId) return '';
  return WORKSPACE_CONFIG[ws]?.views?.find(v => v.id === viewId)?.label || viewId;
}

export const LEGACY_WORKSPACE_MAP: Record<string, WorkspaceId> = {
  home: 'dashboard',
  operations: 'activity',
  threats: 'security',
};

export const LEGACY_VIEW_MAP: Record<string, string> = {
  analysis: 'realtime',
  'threat-lab': 'threats',
  'auto-research': 'intel',
  'agent-overview': 'overview',
};
