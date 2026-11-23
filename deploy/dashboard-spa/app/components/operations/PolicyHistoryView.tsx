'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { mastyfAiFetch } from '@/lib/mastyf-ai-api';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';

type Version = {
  id: string;
  savedAt: string;
  savedBy: string | null;
  sha256: string;
  bytes: number;
  ruleCount: number | null;
  mode: string | null;
  reason: 'save' | 'rule-change' | 'restore' | 'before-first-save';
  current: boolean;
};

type DiffLine = { kind: 'same' | 'add' | 'del'; text: string };

/** Line diff (longest common subsequence). Policies are a few hundred lines, so O(n·m) is fine. */
function diffLines(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n/g, '\n').split('\n');
  const b = after.replace(/\r\n/g, '\n').split('\n');
  const n = a.length;
  const m = b.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: 'same', text: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push({ kind: 'del', text: a[i] }); i++; }
    else { out.push({ kind: 'add', text: b[j] }); j++; }
  }
  while (i < n) out.push({ kind: 'del', text: a[i++] });
  while (j < m) out.push({ kind: 'add', text: b[j++] });
  return out;
}

/** Only changed lines with three lines of context, like a unified diff. */
function withContext(lines: DiffLine[], ctx = 3): Array<DiffLine | { kind: 'gap'; text: string }> {
  const keep = new Set<number>();
  lines.forEach((l, idx) => {
    if (l.kind !== 'same') for (let k = Math.max(0, idx - ctx); k <= Math.min(lines.length - 1, idx + ctx); k++) keep.add(k);
  });
  const out: Array<DiffLine | { kind: 'gap'; text: string }> = [];
  let last = -1;
  [...keep].sort((x, y) => x - y).forEach((idx) => {
    if (last >= 0 && idx > last + 1) out.push({ kind: 'gap', text: `${idx - last - 1} unchanged lines` });
    out.push(lines[idx]);
    last = idx;
  });
  return out;
}

const REASON: Record<Version['reason'], string> = {
  save: 'Saved in the editor',
  'rule-change': 'Changed in Active rules',
  restore: 'Restored from an earlier version',
  'before-first-save': 'Policy as it was before dashboard edits',
};

export function PolicyHistoryView({
  currentYaml,
  canMutate,
  onOpenInEditor,
}: {
  currentYaml: string;
  canMutate: boolean;
  onOpenInEditor: (yaml: string, versionId: string, savedAt: string) => void;
}) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedYaml, setSelectedYaml] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await mastyfAiFetch('/api/policy/history');
    if (!res.ok) {
      setError(`Could not load history (HTTP ${res.status})`);
      return;
    }
    const body = (await res.json()) as { versions: Version[] };
    setVersions(body.versions);
    const firstOld = body.versions.find((v) => !v.current) ?? body.versions[0];
    setSelected((s) => s ?? firstOld?.id ?? null);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selected) { setSelectedYaml(null); return; }
    let cancelled = false;
    void mastyfAiFetch(`/api/policy/history/${encodeURIComponent(selected)}`).then(async (res) => {
      if (!res.ok || cancelled) return;
      const body = (await res.json()) as { yaml: string };
      setSelectedYaml(body.yaml);
    });
    return () => { cancelled = true; };
  }, [selected]);

  const diff = useMemo(
    () => (selectedYaml !== null ? withContext(diffLines(selectedYaml, currentYaml)) : []),
    [selectedYaml, currentYaml],
  );
  const changed = diff.filter((d) => d.kind === 'add' || d.kind === 'del').length;
  const sel = versions?.find((v) => v.id === selected) ?? null;

  if (error) return <Card title="Version history"><EmptyState title="History unavailable" message={error} /></Card>;
  if (!versions) return <Card title="Version history"><p className="text-sm text-muted">Loading saved versions</p></Card>;

  return (
    <div className="policy-history">
      <Card title="Version history" subtitle="Every time the policy is saved from this dashboard, the previous and new versions are kept here.">
        {versions.length === 0 ? (
          <EmptyState icon={History} title="No versions yet" message="Save the policy in the editor to start its history." />
        ) : (
          <ul className="ph-list">
            {versions.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  className={`ph-item${v.id === selected ? ' active' : ''}`}
                  onClick={() => setSelected(v.id)}
                  aria-pressed={v.id === selected}
                >
                  <span className="ph-when">{new Date(v.savedAt).toLocaleString()}</span>
                  <span className="ph-meta">
                    {REASON[v.reason]}
                    {v.savedBy ? ` by ${v.savedBy}` : ''}
                    {v.ruleCount != null ? `, ${v.ruleCount} rules` : ''}
                    {v.mode ? `, ${v.mode} mode` : ''}
                  </span>
                  {v.current && <Badge variant="success">Current</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {sel && (
        <Card
          title={sel.current ? 'This is the policy in force now' : 'Changes from this version to the current policy'}
          subtitle={sel.current ? undefined : `${changed} changed ${changed === 1 ? 'line' : 'lines'}. Removed lines are this version; added lines are the current policy.`}
          actions={
            !sel.current && selectedYaml !== null ? (
              <Button
                variant="primary"
                size="sm"
                disabled={!canMutate}
                title={canMutate ? undefined : 'Restoring needs the operator role'}
                onClick={() => onOpenInEditor(selectedYaml, sel.id, sel.savedAt)}
              >
                <RotateCcw size={13} aria-hidden="true" /> Restore this version
              </Button>
            ) : undefined
          }
        >
          {selectedYaml === null ? (
            <p className="text-sm text-muted">Loading</p>
          ) : sel.current ? (
            <p className="text-sm text-muted">Pick an older version on the left to see what changed since then.</p>
          ) : changed === 0 ? (
            <p className="text-sm text-muted">No differences.</p>
          ) : (
            <pre className="ph-diff" aria-label="Line differences">
              {diff.map((d, k) => (
                <span key={k} className={`ph-line ${d.kind}`}>
                  {d.kind === 'add' ? '+ ' : d.kind === 'del' ? '- ' : d.kind === 'gap' ? '' : '  '}
                  {d.text}
                  {'\n'}
                </span>
              ))}
            </pre>
          )}
          {!sel.current && (
            <p className="text-xs text-muted" style={{ marginTop: 10 }}>
              Restoring opens this version in the editor. Nothing changes until you save it there.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
