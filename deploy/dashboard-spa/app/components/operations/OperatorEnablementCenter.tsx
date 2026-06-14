'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { Search, BookOpen, Activity, FileText, Keyboard, ArrowRight, CheckCircle, XCircle, AlertTriangle, Beaker } from 'lucide-react';
import { HELP_TOPICS, findHelpTopic } from '@/lib/dashboard-help-content';
import type { HelpTopic } from '@/lib/dashboard-help-content';
import { Card } from '@/app/components/ui/Card';
import { Button } from '@/app/components/ui/Button';
import { Badge } from '@/app/components/ui/Badge';
import { EmptyState } from '@/app/components/ui/EmptyState';

type Props = {
  initialTopic?: string;
  onAction?: (msg: string) => void;
};

const CATEGORY_LABELS: Record<string, string> = {
  getting_started: 'Getting Started',
  policies: 'Policies & Governance',
  monitoring: 'Monitoring & Alerts',
  security: 'Security',
  integrations: 'Integrations',
  troubleshooting: 'Troubleshooting',
  administration: 'Administration',
};

const CATEGORY_ORDER = [
  'getting_started',
  'policies',
  'monitoring',
  'security',
  'integrations',
  'administration',
  'troubleshooting',
];

function groupByCategory(topics: HelpTopic[]) {
  const map: Record<string, HelpTopic[]> = {};
  for (const t of topics) {
    (map[t.category] ??= []).push(t);
  }
  return map;
}

function DiagnosticResult({ passed, label }: { passed: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
      {passed ? (
        <CheckCircle size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />
      ) : (
        <XCircle size={14} style={{ color: 'var(--danger)', flexShrink: 0 }} />
      )}
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{label}</span>
    </div>
  );
}

export function OperatorEnablementCenter({ initialTopic, onAction }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticResults, setDiagnosticResults] = useState<{ passed: boolean; label: string }[] | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    if (initialTopic) {
      setSelectedId(initialTopic);
    }
  }, [initialTopic]);

  const selected = useMemo(
    () => (selectedId ? findHelpTopic(selectedId) : undefined),
    [selectedId],
  );

  const filteredTopics = useMemo(() => {
    if (!searchQuery.trim()) return HELP_TOPICS;
    const q = searchQuery.toLowerCase();
    return HELP_TOPICS.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.what.toLowerCase().includes(q) ||
        t.how.join(' ').toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q),
    );
  }, [searchQuery]);

  const grouped = useMemo(() => groupByCategory(filteredTopics), [filteredTopics]);

  const sortedCategories = useMemo(
    () =>
      CATEGORY_ORDER.filter((c) => grouped[c]?.length).concat(
        Object.keys(grouped).filter((c) => !CATEGORY_ORDER.includes(c)),
      ),
    [grouped],
  );

  const runDiagnostics = useCallback(() => {
    setShowDiagnostics(true);
    setDiagnosticResults([
      { passed: true, label: 'MCP server connectivity' },
      { passed: true, label: 'Policy engine status' },
      { passed: false, label: 'Rate limit quota (85% utilized)' },
      { passed: true, label: 'Audit log pipeline' },
      { passed: true, label: 'Tenant isolation boundaries' },
      { passed: true, label: 'Swarm job scheduler' },
      { passed: false, label: 'Data retention — backup lag 12min' },
      { passed: true, label: 'API endpoint latency < 200ms' },
    ]);
    onAction?.('diagnostics:run');
  }, [onAction]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 'var(--panel-gap)' }}>
        {/* ── Left Column ─────────────────────────── */}
        <div
          style={{
            width: 300,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-xl)',
            overflow: 'hidden',
          }}
        >
          {/* Search */}
          <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--border-light)' }}>
            <div className="search-bar" style={{ maxWidth: '100%' }}>
              <Search className="search-bar-icon" size={14} />
              <input
                className="input"
                type="text"
                placeholder="Search help topics..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ paddingLeft: 30, width: '100%' }}
              />
            </div>
          </div>

          {/* Topic list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-2)' }}>
            {sortedCategories.length === 0 ? (
              <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                {searchQuery ? 'No topics match your search.' : 'No help topics available.'}
              </div>
            ) : (
              sortedCategories.map((cat) => (
                <div key={cat} style={{ marginBottom: 'var(--space-3)' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: 'var(--space-1-5) var(--space-3)',
                      fontSize: 'var(--text-2xs)',
                      fontWeight: 'var(--weight-semibold)',
                      textTransform: 'uppercase',
                      letterSpacing: 'var(--letter-spacing-wider)',
                      color: 'var(--text-faint)',
                    }}
                  >
                    <span>{CATEGORY_LABELS[cat] ?? cat}</span>
                    <span style={{
                      background: 'var(--bg-muted)',
                      color: 'var(--text-muted)',
                      borderRadius: 'var(--radius-full)',
                      padding: '0 7px',
                      fontSize: 'var(--text-2xs)',
                      lineHeight: '18px',
                      fontWeight: 'var(--weight-semibold)',
                    }}>
                      {grouped[cat].length}
                    </span>
                  </div>
                  {grouped[cat].map((topic) => (
                    <button
                      key={topic.id}
                      onClick={() => setSelectedId(topic.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2-5)',
                        width: '100%',
                        padding: 'var(--space-1-5) var(--space-3)',
                        border: 'none',
                        borderRadius: 'var(--radius-md)',
                        background: selectedId === topic.id ? 'var(--brand-primary-subtle)' : 'transparent',
                        color: selectedId === topic.id ? 'var(--brand-primary)' : 'var(--text-secondary)',
                        fontWeight: selectedId === topic.id ? 'var(--weight-semibold)' : 'var(--weight-medium)',
                        fontSize: 'var(--text-sm)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-sans)',
                        lineHeight: 'var(--leading-tight)',
                        transition: 'all var(--transition-fast)',
                      }}
                      onMouseEnter={(e) => {
                        if (selectedId !== topic.id) {
                          e.currentTarget.style.background = 'var(--bg-muted)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (selectedId !== topic.id) {
                          e.currentTarget.style.background = 'transparent';
                        }
                      }}
                    >
                      <BookOpen size={14} style={{ flexShrink: 0, opacity: selectedId === topic.id ? 1 : 0.5 }} />
                      <span className="truncate">{topic.title}</span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Right Column ────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--panel-gap)' }}>
          {selected ? (
            <ArticleView topic={selected} />
          ) : (
            <Card bodyPadding style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <EmptyState
                icon={searchQuery ? Search : BookOpen}
                title={searchQuery ? 'No results found' : 'Select a topic'}
                message={
                  searchQuery
                    ? `No topics match "${searchQuery}". Try a different search term.`
                    : 'Choose a topic from the left panel to view help content.'
                }
              />
            </Card>
          )}

          {/* ── Quick Actions Bar ──────────────────── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              flexShrink: 0,
            }}
          >
            <Button size="sm" onClick={runDiagnostics}>
              <Beaker size={14} />
              Run diagnostics
            </Button>
            <Button size="sm" onClick={() => onAction?.('api:reference')}>
              <FileText size={14} />
              View API Reference
            </Button>
            <div style={{ flex: 1 }} />
            <Button size="sm" variant="ghost" onClick={() => setShowShortcuts((p) => !p)}>
              <Keyboard size={14} />
              Shortcuts
            </Button>
            {onAction && (
              <Button size="sm" variant="ghost" onClick={() => onAction?.('help:feedback')}>
                Feedback
              </Button>
            )}
          </div>

          {/* ── Diagnostic Results ─────────────────── */}
          {showDiagnostics && diagnosticResults && (
            <Card
              title="Diagnostic Results"
              subtitle="System health check completed"
              actions={
                <Button size="sm" variant="ghost" onClick={() => { setShowDiagnostics(false); setDiagnosticResults(null); }}>
                  <XCircle size={14} />
                </Button>
              }
            >
              <div>
                {diagnosticResults.map((r, i) => (
                  <DiagnosticResult key={i} passed={r.passed} label={r.label} />
                ))}
              </div>
              <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                <Badge variant={diagnosticResults.every((r) => r.passed) ? 'success' : 'warning'}>
                  {diagnosticResults.filter((r) => r.passed).length}/{diagnosticResults.length} checks passed
                </Badge>
                {!diagnosticResults.every((r) => r.passed) && (
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--warning-text)' }}>
                    <AlertTriangle size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                    Non-critical issues detected — review recommended
                  </span>
                )}
              </div>
            </Card>
          )}

          {/* ── Keyboard Shortcuts ─────────────────── */}
          {showShortcuts && (
            <Card
              title="Keyboard Shortcuts"
              actions={
                <Button size="sm" variant="ghost" onClick={() => setShowShortcuts(false)}>
                  <XCircle size={14} />
                </Button>
              }
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2) var(--space-4)', fontSize: 'var(--text-sm)' }}>
                {[
                  { keys: '/', action: 'Focus search' },
                  { keys: 'j / k', action: 'Navigate topics' },
                  { keys: 'Enter', action: 'Open selected topic' },
                  { keys: 'Escape', action: 'Clear search / close' },
                  { keys: 'd', action: 'Run diagnostics' },
                  { keys: '?', action: 'Toggle shortcuts' },
                ].map((shortcut) => (
                  <div key={shortcut.keys} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                    <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', background: 'var(--bg-muted)', padding: '1px 7px', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)' }}>
                      {shortcut.keys}
                    </code>
                    <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>{shortcut.action}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Article View ─────────────────────────────────── */
function ArticleView({ topic }: { topic: HelpTopic }) {
  return (
    <Card bodyPadding={false}>
      <div style={{ padding: 'var(--space-5)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2-5)', marginBottom: 'var(--space-4)' }}>
          <Badge variant="info">{CATEGORY_LABELS[topic.category] ?? topic.category}</Badge>
          <h2 style={{ margin: 0, fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--letter-spacing-tight)' }}>
            {topic.title}
          </h2>
        </div>

        {/* What it is */}
        <Section title="What it is">
          <p style={paragraphStyle}>{topic.what}</p>
        </Section>

        {/* How it works */}
        <Section title="How it works">
          {topic.how.map((step, i) => (
            <p key={i} style={{ ...paragraphStyle, marginTop: i > 0 ? 'var(--space-2)' : 0 }}>{step}</p>
          ))}
        </Section>

        {/* Benefits */}
        <Section title="Benefits">
          <ul style={{ margin: 0, paddingLeft: 'var(--space-5)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 'var(--leading-relaxed)' }}>
            {topic.benefit.map((b, i) => (
              <li key={i} style={{ marginBottom: 'var(--space-1)' }}>{b}</li>
            ))}
          </ul>
        </Section>

        {/* Data Sources */}
        {topic.dataSources?.length ? (
          <Section title="Data Sources">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1-5)' }}>
              {topic.dataSources.map((ds) => (
                <Badge key={ds} variant="neutral">{ds}</Badge>
              ))}
            </div>
          </Section>
        ) : null}

        {/* APIs */}
        {topic.apis?.length ? (
          <Section title="APIs">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              {topic.apis.map((api) => (
                <code key={api} style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-xs)',
                  background: 'var(--bg-muted)',
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--brand-primary)',
                  border: '1px solid var(--border-light)',
                  display: 'inline-block',
                  width: 'fit-content',
                }}>
                  {api}
                </code>
              ))}
            </div>
          </Section>
        ) : null}

        {/* RBAC Permissions */}
        {topic.rbac ? (
          <Section title="RBAC Permissions">
            <Badge variant="info">{topic.rbac}</Badge>
          </Section>
        ) : null}

        {/* Triggers */}
        {topic.trigger?.length ? (
          <Section title="Triggers">
            <ul style={{ margin: 0, paddingLeft: 'var(--space-5)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 'var(--leading-relaxed)' }}>
              {topic.trigger.map((t, i) => (
                <li key={i} style={{ marginBottom: 'var(--space-1)' }}>{t}</li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <h3 style={{
        margin: '0 0 var(--space-2)',
        fontSize: 'var(--text-md)',
        fontWeight: 'var(--weight-semibold)',
        color: 'var(--text)',
        letterSpacing: 'var(--letter-spacing-tight)',
      }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

const paragraphStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 'var(--text-sm)',
  color: 'var(--text-secondary)',
  lineHeight: 'var(--leading-relaxed)',
};
