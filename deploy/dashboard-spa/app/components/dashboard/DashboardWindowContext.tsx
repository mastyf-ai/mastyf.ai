'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

export type DashboardWindow = '1h' | '12h' | '24h' | '7d' | '30d' | '90d';

const STORAGE_KEY = 'mastyf-ai-dashboard-window';
const CHANGE_EVENT = 'mastyf-ai-dashboard-window-changed';
const DEFAULT_WINDOW: DashboardWindow = '7d';

const WINDOW_DAYS: Record<DashboardWindow, number> = {
  '1h': 1 / 24,
  '12h': 0.5,
  '24h': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

const VALID_WINDOWS: readonly DashboardWindow[] = ['1h', '12h', '24h', '7d', '30d', '90d'];

type ContextValue = {
  window: DashboardWindow;
  windowDays: number;
  windowParam: string;
  setWindow: (w: DashboardWindow) => void;
};

const DashboardWindowContext = createContext<ContextValue | null>(null);

function readStoredWindow(): DashboardWindow {
  if (typeof window === 'undefined') return DEFAULT_WINDOW;
  const stored = window.localStorage?.getItem(STORAGE_KEY);
  if (stored && VALID_WINDOWS.includes(stored as DashboardWindow)) {
    return stored as DashboardWindow;
  }
  return DEFAULT_WINDOW;
}

/**
 * Public helper for components outside the provider (e.g. `DashboardClient`
 * which mounts above `DashboardWindowProvider`). Reads from localStorage and
 * subscribes to the CHANGE_EVENT broadcast so refreshAll() always has the
 * latest window selection.
 */
export function useCurrentWindowDays(): {
  windowLabel: DashboardWindow;
  windowDays: number;
  windowParam: string;
} {
  const subscribe = useCallback((cb: () => void) => {
    if (typeof window === 'undefined') return () => {};
    const handler = () => cb();
    window.addEventListener(CHANGE_EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);
  const getSnapshot = useCallback(() => readStoredWindow(), []);
  const getServerSnapshot = useCallback(() => DEFAULT_WINDOW, []);
  const label = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    windowLabel: label,
    windowDays: WINDOW_DAYS[label],
    // Send a label to the backend (e.g. "1h", "24h"). The backend's
    // parseWindowDays now accepts both labels and fractional numbers.
    windowParam: label,
  };
}

export function DashboardWindowProvider({ children }: { children: ReactNode }) {
  const [windowLabel, setWindowLabel] = useState<DashboardWindow>(DEFAULT_WINDOW);

  useEffect(() => {
    setWindowLabel(readStoredWindow());
  }, []);

  const setWindow = useCallback((w: DashboardWindow) => {
    setWindowLabel(w);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEY, w);
      } catch {
        /* private mode / storage disabled */
      }
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { window: w } }));
    }
  }, []);

  const value = useMemo<ContextValue>(
    () => ({
      window: windowLabel,
      windowDays: WINDOW_DAYS[windowLabel],
      windowParam: windowLabel,
      setWindow,
    }),
    [windowLabel, setWindow],
  );

  return (
    <DashboardWindowContext.Provider value={value}>{children}</DashboardWindowContext.Provider>
  );
}

export function useDashboardWindow(): ContextValue {
  const ctx = useContext(DashboardWindowContext);
  if (!ctx) {
    return {
      window: DEFAULT_WINDOW,
      windowDays: WINDOW_DAYS[DEFAULT_WINDOW],
      windowParam: DEFAULT_WINDOW,
      setWindow: () => {},
    };
  }
  return ctx;
}

const WINDOW_OPTIONS: { value: DashboardWindow; short: string; label: string }[] = [
  { value: '1h', short: '1h', label: 'Last hour' },
  { value: '12h', short: '12h', label: 'Last 12 hours' },
  { value: '24h', short: '24h', label: 'Last 24 hours' },
  { value: '7d', short: '7d', label: 'Last 7 days' },
  { value: '30d', short: '30d', label: 'Last 30 days' },
  { value: '90d', short: '90d', label: 'Last 90 days' },
];

export function DashboardWindowSelector() {
  const { window: w, setWindow } = useDashboardWindow();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const current = WINDOW_OPTIONS.find((o) => o.value === w) ?? WINDOW_OPTIONS[3];

  return (
    <div className="time-window-picker" ref={ref}>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => setOpen((p) => !p)}
        aria-label="Time window"
        style={{ gap: 6 }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        {current.short}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="time-window-dropdown">
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`time-window-option${opt.value === w ? ' active' : ''}`}
              onClick={() => { setWindow(opt.value); setOpen(false); }}
            >
              <span className="time-window-short">{opt.short}</span>
              <span className="time-window-label">{opt.label}</span>
              {opt.value === w && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto', color: 'var(--brand-primary)' }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
