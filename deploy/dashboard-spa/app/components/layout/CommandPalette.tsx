'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { DEFAULT_VIEW, NAV_SECTIONS, WORKSPACE_CONFIG, type WorkspaceId } from '@/lib/workspace-nav';

type Entry = { id: WorkspaceId; view?: string; title: string; where: string };

/** Every workspace and every view inside it, built from the same config the nav uses. */
function allEntries(): Entry[] {
  const order = NAV_SECTIONS.flatMap((s) => s.items);
  const out: Entry[] = [];
  for (const id of order) {
    const cfg = WORKSPACE_CONFIG[id];
    out.push({ id, view: DEFAULT_VIEW[id], title: cfg.label, where: 'Workspace' });
    for (const v of cfg.views ?? []) {
      out.push({ id, view: v.id, title: v.label, where: cfg.label });
    }
  }
  return out;
}

export function CommandPalette({
  onClose,
  onNavigate,
}: {
  onClose: () => void;
  onNavigate: (id: WorkspaceId, view?: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const entries = useMemo(allEntries, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => `${e.title} ${e.where}`.toLowerCase().includes(q));
  }, [entries, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setIndex(0);
  }, [query]);

  const choose = (e: Entry | undefined) => {
    if (e) onNavigate(e.id, e.view);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[index]);
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Go to a page"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="palette-input">
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Go to a page, for example Audit Trail or Policy Editor"
            aria-label="Search pages"
            aria-controls="palette-results"
          />
        </div>
        <ul className="palette-results" id="palette-results" role="listbox">
          {results.length === 0 && <li className="palette-empty">Nothing matches “{query}”.</li>}
          {results.map((r, i) => (
            <li
              key={`${r.id}:${r.view ?? ''}:${r.title}`}
              role="option"
              aria-selected={i === index}
              className={`palette-item${i === index ? ' active' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(r)}
            >
              <span>{r.title}</span>
              <span className="palette-where">{r.where}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
