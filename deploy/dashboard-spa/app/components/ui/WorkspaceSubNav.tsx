'use client';

type Tab<T extends string> = { id: T; label: string };

type Props<T extends string> = {
  tabs: Tab<T>[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
};

export function WorkspaceSubNav<T extends string>({ tabs, active, onChange, className = '' }: Props<T>) {
  return (
    <nav className={`subnav ${className}`.trim()} aria-label="Section views" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className={active === t.id ? 'subnav-item active' : 'subnav-item'}
          aria-current={active === t.id ? 'page' : undefined}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
