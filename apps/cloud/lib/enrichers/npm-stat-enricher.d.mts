export type NpmStatTrend = {
  available: boolean;
  source: 'npm-stat' | 'unavailable';
  total30d: number;
  last7dAvg: number;
  prev23dAvg: number;
  trendRatio: number;
  spikeDetected: boolean;
  collapseDetected: boolean;
  daily: Record<string, number>;
};

export function fetchNpmStatTrend(packageName: string): Promise<NpmStatTrend>;
