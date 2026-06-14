'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { fetchDashboardRegions } from '@/lib/mastyf-ai-api';

const STORAGE_KEY = 'mastyf-ai-dashboard-region';

type ContextValue = {
  region: string;
  setRegion: (region: string) => void;
  regions: string[];
  loadingRegions: boolean;
};

const DashboardRegionContext = createContext<ContextValue | null>(null);

function readStoredRegion(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(STORAGE_KEY) || '';
}

export function DashboardRegionProvider({ children }: { children: ReactNode }) {
  const [region, setRegionState] = useState('');
  const [regions, setRegions] = useState<string[]>([]);
  const [loadingRegions, setLoadingRegions] = useState(true);

  useEffect(() => {
    setRegionState(readStoredRegion());
    void fetchDashboardRegions().then((r) => {
      setRegions(r?.regions ?? []);
      setLoadingRegions(false);
    });
  }, []);

  const setRegion = useCallback((value: string) => {
    setRegionState(value);
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  const value = useMemo(
    () => ({ region, setRegion, regions, loadingRegions }),
    [region, setRegion, regions, loadingRegions],
  );

  return (
    <DashboardRegionContext.Provider value={value}>{children}</DashboardRegionContext.Provider>
  );
}

export function useDashboardRegion(): ContextValue {
  const ctx = useContext(DashboardRegionContext);
  if (!ctx) {
    return { region: '', setRegion: () => {}, regions: [], loadingRegions: false };
  }
  return ctx;
}

export function DashboardRegionSelector() {
  const { region, setRegion, regions, loadingRegions } = useDashboardRegion();
  if (loadingRegions || regions.length === 0) return null;

  return (
    <div className="time-window-picker">
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => {
          const idx = regions.indexOf(region);
          const next = idx < regions.length - 1 ? regions[idx + 1] : '';
          setRegion(next);
        }}
        aria-label="Toggle region filter"
        style={{ gap: 6 }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        {region || 'All regions'}
      </button>
    </div>
  );
}
