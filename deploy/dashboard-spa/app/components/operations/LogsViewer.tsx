'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Filter,
  Download,
  Trash2,
  Copy,
  X,
  AlertCircle,
  AlertTriangle,
  Bug,
  Shield,
  Activity,
  Server,
  User,
  Key,
  FileText,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  fetchLogEntries,
  clearLogs,
  exportLogs,
  fetchLogRetentionConfig,
  updateLogRetentionConfig,
  type LogEntry,
  type LogQueryParams,
} from '@/lib/mastyf-ai-api';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';

type LogsView = 'events' | 'system' | 'retention';

const CATEGORY_ICONS: Record<string, typeof Activity> = {
  user_activity: User,
  security: Shield,
  deployment: Server,
  system: Activity,
  error: AlertCircle,
  warning: AlertTriangle,
  debug: Bug,
  swarm: Activity,
  api_request: FileText,
  policy_decision: Shield,
  auth: Key,
  plugin: Server,
};

const CATEGORY_LABELS: Record<string, string> = {
  user_activity: 'User Activity',
  security: 'Security Events',
  deployment: 'Deployments',
  system: 'System Events',
  error: 'Errors',
  warning: 'Warnings',
  debug: 'Debug Logs',
  swarm: 'Swarm Analysis',
  api_request: 'API Requests',
  policy_decision: 'Policy Decisions',
  auth: 'Authentication',
  plugin: 'Plugin Events',
};

const LEVEL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: '#fef2f2', text: '#991b1b', border: '#fecaca' },
  error: { bg: '#fef2f2', text: '#b91c1c', border: '#fecaca' },
  warn: { bg: '#fffbeb', text: '#92400e', border: '#fde68a' },
  info: { bg: '#eff6ff', text: '#1e40af', border: '#bfdbfe' },
  debug: { bg: '#f9fafb', text: '#6b7280', border: '#e5e7eb' },
};

const LEVEL_BADGE: Record<string, { variant: 'danger' | 'warning' | 'info' | 'success'; dot: boolean }> = {
  critical: { variant: 'danger', dot: true },
  error: { variant: 'danger', dot: false },
  warn: { variant: 'warning', dot: true },
  info: { variant: 'info', dot: false },
  debug: { variant: 'info', dot: false },
};

const RETENTION_OPTIONS = [
  { label: '24 hours', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year', days: 365 },
  { label: 'Never', days: 0 },
];

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return ts;
  }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

type Props = {
  view: LogsView;
  onViewChange: (v: LogsView) => void;
  refreshKey?: number;
};



export function LogsViewer({ view, onViewChange, refreshKey = 0 }: Props) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<LogEntry | null>(null);
  const [liveMode, setLiveMode] = useState(false);
  const [liveEntries, setLiveEntries] = useState<LogEntry[]>([]);
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [retentionDays, setRetentionDays] = useState(30);
  const [maxSizeMb, setMaxSizeMb] = useState(100);
  const [enabledCategories, setEnabledCategories] = useState<string[]>([]);
  const [savingRetention, setSavingRetention] = useState(false);
  const [clearConfirm, setClearConfirm] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadEntries = useCallback(async (isLive = false) => {
    try {
      if (!isLive) setLoading(true);
      const params: LogQueryParams = {};
      if (search) params.search = search;
      if (categoryFilter) params.category = categoryFilter;
      if (levelFilter) params.level = levelFilter;
      params.limit = 100;
      const result = await fetchLogEntries(params);
      if (isLive) {
        setLiveEntries(prev => {
          const combined = [...result.entries];
          const existingIds = new Set(combined.map(e => e.id));
          const merged = [...combined, ...prev.filter(e => !existingIds.has(e.id))];
          return merged.slice(0, 100);
        });
      } else {
        setEntries(result.entries);
        setTotal(result.total);
        setCategories(result.categories);
        setLevels(result.levels);
      }
    } catch {
      if (!isLive) setError('Failed to load logs');
    } finally {
      if (!isLive) setLoading(false);
    }
  }, [search, categoryFilter, levelFilter]);

  const loadRetentionConfig = useCallback(async () => {
    const config = await fetchLogRetentionConfig();
    setRetentionDays(config.retentionDays);
    setMaxSizeMb(config.maxSizeMb);
    setEnabledCategories(config.enabledCategories);
  }, []);

  useEffect(() => {
    if (view === 'events' || view === 'system') {
      void loadEntries();
    }
    if (view === 'retention') {
      void loadRetentionConfig();
    }
  }, [view, refreshKey, loadEntries, loadRetentionConfig]);

  useEffect(() => {
    if (liveMode && (view === 'events' || view === 'system')) {
      liveIntervalRef.current = setInterval(() => {
        void loadEntries(true);
      }, 3000);
    }
    return () => {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
        liveIntervalRef.current = null;
      }
    };
  }, [liveMode, view, loadEntries]);

  const displayEntries = useMemo(() => {
    if (liveMode) return liveEntries;
    return entries;
  }, [entries, liveEntries, liveMode]);

  const handleSearch = useCallback(() => {
    setSearch(searchInput);
  }, [searchInput]);

  const handleClearSearch = useCallback(() => {
    setSearchInput('');
    setSearch('');
  }, []);

  const handleClearLogs = useCallback(async (cat?: string) => {
    const result = await clearLogs(cat);
    if (result.ok) {
      setEntries([]);
      setTotal(0);
    }
    setClearConfirm(null);
  }, []);

  const handleExport = useCallback(async () => {
    const result = await exportLogs({
      search,
      category: categoryFilter,
      level: levelFilter,
    });
    if (result.ok && result.blob) {
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mastyf-ai-logs-${new Date().toISOString().slice(0, 10)}.log`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [search, categoryFilter, levelFilter]);

  const handleSaveRetention = useCallback(async () => {
    setSavingRetention(true);
    const result = await updateLogRetentionConfig({
      retentionDays,
      maxSizeMb,
      enabledCategories,
    });
    setSavingRetention(false);
  }, [retentionDays, maxSizeMb, enabledCategories]);

  const toggleCategory = useCallback((cat: string) => {
    setEnabledCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat],
    );
  }, []);

  const filterBar = (
    <div className="logs-filter-bar" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 1, minWidth: 200 }}>
        <Search size={14} className="text-muted" />
        <input
          type="text"
          placeholder="Search logs..."
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          style={{
            flex: 1,
            padding: '6px 8px',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 12,
            background: 'var(--bg-elevated)',
            color: 'var(--text)',
          }}
        />
        {searchInput && (
          <button onClick={handleClearSearch} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={14} />
          </button>
        )}
        <Button variant="primary" size="sm" onClick={handleSearch}>Search</Button>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Filter size={14} className="text-muted" />
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          style={{
            padding: '4px 6px',
            border: '1px solid var(--border)',
            borderRadius: 4,
            fontSize: 11,
            background: 'var(--bg-elevated)',
            color: 'var(--text)',
          }}
        >
          <option value="">All Categories</option>
          {categories.map(cat => (
            <option key={cat} value={cat}>{CATEGORY_LABELS[cat] || cat}</option>
          ))}
        </select>

        <select
          value={levelFilter}
          onChange={e => setLevelFilter(e.target.value)}
          style={{
            padding: '4px 6px',
            border: '1px solid var(--border)',
            borderRadius: 4,
            fontSize: 11,
            background: 'var(--bg-elevated)',
            color: 'var(--text)',
          }}
        >
          <option value="">All Levels</option>
          {levels.map(lvl => (
            <option key={lvl} value={lvl}>{lvl.toUpperCase()}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 4 }}>
        <Button
          variant={liveMode ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setLiveMode(v => !v)}
        >
          <Activity size={12} style={{ marginRight: 4 }} />
          {liveMode ? 'LIVE' : 'Live'}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void loadEntries()}>
          <RefreshCw size={12} style={{ marginRight: 4 }} />
          Refresh
        </Button>
        <Button variant="secondary" size="sm" onClick={handleExport}>
          <Download size={12} style={{ marginRight: 4 }} />
          Export
        </Button>
        {clearConfirm ? (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--danger)' }}>Clear all?</span>
            <Button variant="danger" size="sm" onClick={() => void handleClearLogs()}>Yes</Button>
            <Button variant="ghost" size="sm" onClick={() => setClearConfirm(null)}>No</Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setClearConfirm('all')}>
            <Trash2 size={12} style={{ marginRight: 4 }} />
            Clear
          </Button>
        )}
      </div>
    </div>
  );

  const renderLogEntry = (entry: LogEntry) => {
    const levelStyle = LEVEL_COLORS[entry.level] || LEVEL_COLORS.info;
    const levelBadge = LEVEL_BADGE[entry.level] || LEVEL_BADGE.info;
    const CatIcon = CATEGORY_ICONS[entry.category] || FileText;
    const isExpanded = expandedId === entry.id;

    return (
      <div
        key={entry.id}
        className="logs-entry"
        style={{
          padding: '8px 10px',
          borderBottom: '1px solid var(--border-light)',
          cursor: 'pointer',
          transition: 'background 0.1s',
          background: isExpanded ? 'var(--bg-muted)' : 'transparent',
        }}
        onMouseEnter={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; }}
        onMouseLeave={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            marginTop: 1,
            background: levelStyle.bg,
            color: levelStyle.text,
          }}>
            <CatIcon size={12} />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <Badge variant={levelBadge.variant} dot={levelBadge.dot}>
                {entry.level.toUpperCase()}
              </Badge>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {formatTimestamp(entry.timestamp)}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                {CATEGORY_LABELS[entry.category] || entry.category}
              </span>
              {entry.source && (
                <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                  [{entry.source}]
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4, wordBreak: 'break-word' }}>
              {entry.message}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 2, flexShrink: 0, marginTop: 2 }}>
            <button
              onClick={() => setExpandedId(isExpanded ? null : entry.id)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
              title="View details"
            >
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            <button
              onClick={() => copyToClipboard(`[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.category}] ${entry.message}`)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
              title="Copy entry"
            >
              <Copy size={14} />
            </button>
          </div>
        </div>

        {isExpanded && (
          <div style={{
            marginTop: 8,
            padding: '8px 10px',
            background: 'var(--bg-elevated)',
            borderRadius: 6,
            fontSize: 11,
            border: '1px solid var(--border)',
          }}>
            {entry.details && (
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 2 }}>Details</div>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--text)' }}>{entry.details}</pre>
              </div>
            )}
            {entry.metadata && Object.keys(entry.metadata).length > 0 && (
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 2 }}>Metadata</div>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--text-tertiary)' }}>
                  {JSON.stringify(entry.metadata, null, 2)}
                </pre>
              </div>
            )}
            {!entry.details && (!entry.metadata || Object.keys(entry.metadata).length === 0) && (
              <div style={{ color: 'var(--text-muted)' }}>No additional details available</div>
            )}
          </div>
        )}
      </div>
    );
  };

  if (view === 'events') {
    return (
      <div className="logs-viewer">
        <Card
          title="Event Log"
          subtitle="Application events, user activity, and system operations"
        >
          {filterBar}

          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Loading logs...
            </div>
          ) : error ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--danger)', fontSize: 13 }}>
              {error}
            </div>
          ) : displayEntries.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No log entries found. {liveMode ? 'Waiting for new events...' : 'Try adjusting filters.'}
            </div>
          ) : (
            <div className="logs-entries">
              <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 10px', borderBottom: '1px solid var(--border)' }}>
                {liveMode ? (
                  <span style={{ color: 'var(--danger)', fontWeight: 600 }}>LIVE</span>
                ) : (
                  <span>{total} entries</span>
                )}
              </div>
              {displayEntries.map(renderLogEntry)}
            </div>
          )}
        </Card>
      </div>
    );
  }

  if (view === 'system') {
    return (
      <div className="logs-viewer">
        <Card
          title="System Log"
          subtitle="Runtime logs, errors, warnings, and debug information"
        >
          {filterBar}

          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Loading system logs...
            </div>
          ) : error ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--danger)', fontSize: 13 }}>
              {error}
            </div>
          ) : displayEntries.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No system log entries found.
            </div>
          ) : (
            <div className="logs-entries">
              <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 10px', borderBottom: '1px solid var(--border)' }}>
                {total} entries
              </div>
              {displayEntries.map(renderLogEntry)}
            </div>
          )}
        </Card>
      </div>
    );
  }

  if (view === 'retention') {
    return (
      <div className="logs-viewer">
        <Card
          title="Log Retention"
          subtitle="Configure log storage, retention period, and recording categories"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Retention Period
              </label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {RETENTION_OPTIONS.map(opt => (
                  <button
                    key={opt.days}
                    onClick={() => setRetentionDays(opt.days)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: `1px solid ${retentionDays === opt.days ? 'var(--brand-primary)' : 'var(--border)'}`,
                      background: retentionDays === opt.days ? 'var(--brand-primary-subtle)' : 'var(--bg-elevated)',
                      color: retentionDays === opt.days ? 'var(--brand-primary)' : 'var(--text)',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: retentionDays === opt.days ? 600 : 400,
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                {retentionDays === 0
                  ? 'Logs will never be automatically deleted.'
                  : `Logs older than ${retentionDays} days will be automatically deleted.`}
              </p>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Max Storage Size
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="range"
                  min={10}
                  max={500}
                  step={10}
                  value={maxSizeMb}
                  onChange={e => setMaxSizeMb(Number(e.target.value))}
                  style={{ flex: 1, maxWidth: 300 }}
                />
                <span style={{ fontSize: 12, color: 'var(--text)', minWidth: 60 }}>{maxSizeMb} MB</span>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Recording Categories
              </label>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                Select which log categories should be recorded:
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
                  const isEnabled = enabledCategories.length === 0 || enabledCategories.includes(key);
                  const CatIcon = CATEGORY_ICONS[key] || FileText;
                  return (
                    <button
                      key={key}
                      onClick={() => toggleCategory(key)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '5px 10px',
                        borderRadius: 6,
                        border: `1px solid ${isEnabled ? 'var(--brand-primary)' : 'var(--border)'}`,
                        background: isEnabled ? 'var(--brand-primary-subtle)' : 'var(--bg-elevated)',
                        color: isEnabled ? 'var(--brand-primary)' : 'var(--text-muted)',
                        cursor: 'pointer',
                        fontSize: 11,
                      }}
                    >
                      <CatIcon size={12} />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <Button variant="primary" onClick={() => void handleSaveRetention()} loading={savingRetention}>
                Save Configuration
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return null;
}
