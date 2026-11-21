import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight } from 'lucide-react';

/**
 * Small visual building blocks for the docs, so a page can show a process or a choice instead of
 * describing it in paragraphs.
 */

export type FlowStep = { label: string; sub?: string; tone?: 'check' | 'ok' | 'stop' };

/**
 * A left-to-right flow with a pulse travelling along it, e.g. "Tool call → Mastyf → Tool".
 * The pulse is decoration; the steps carry the meaning, so it reads the same with motion off.
 */
export function DocFlow({ steps, label }: { steps: FlowStep[]; label: string }) {
  return (
    <ol className="doc-flow" aria-label={label}>
      {steps.map((s, i) => (
        <li key={s.label} className={`doc-flow__step${s.tone ? ` doc-flow__step--${s.tone}` : ''}`}>
          <span className="doc-flow__label">{s.label}</span>
          {s.sub ? <span className="doc-flow__sub">{s.sub}</span> : null}
          {i < steps.length - 1 ? <span className="doc-flow__wire" aria-hidden="true" /> : null}
        </li>
      ))}
    </ol>
  );
}

export type DocPath = { href: string; title: string; line: string; Icon: LucideIcon; tag?: string };

/** Cards that send a reader to the page for their situation. */
export function DocPaths({ paths }: { paths: DocPath[] }) {
  return (
    <ul className="doc-paths">
      {paths.map(({ href, title, line, Icon, tag }) => (
        <li key={href}>
          <Link href={href} className="doc-path">
            <span className="doc-path__icon" aria-hidden="true">
              <Icon size={20} strokeWidth={1.75} />
            </span>
            <span className="doc-path__title">
              {title}
              {tag ? <span className="doc-path__tag">{tag}</span> : null}
            </span>
            <span className="doc-path__line">{line}</span>
            <ArrowRight className="doc-path__go" size={16} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** A plain table. Cells may hold inline elements (code, links). */
export function DocTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="table-scroll doc-block">
      <table className="data-table">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
