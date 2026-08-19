/**
 * npm-stat.com enrichment — daily download time-series used for trend and
 * spike analysis (suspicious download inflation is a known trust signal).
 *
 * Primary source: https://npm-stat.com/api/download-counts?package=X&from&until
 * Falls back gracefully — callers must treat this as optional enrichment.
 */

const NPM_STAT_API = 'https://npm-stat.com/api/download-counts';
const TIMEOUT_MS = 8000;
const MEMORY_CACHE = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function isoDate(daysAgo) {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return d.toISOString().slice(0, 10);
}

/**
 * Fetch 30 days of daily download counts.
 * @param {string} packageName
 * @returns {Promise<{
 *   available: boolean,
 *   source: 'npm-stat' | 'unavailable',
 *   total30d: number,
 *   last7dAvg: number,
 *   prev23dAvg: number,
 *   trendRatio: number,       // last7 avg / prev23 avg (1 = stable)
 *   spikeDetected: boolean,   // last week >> historical baseline
 *   collapseDetected: boolean, // last week << historical baseline
 *   daily: Record<string, number>,
 * }>}
 */
export async function fetchNpmStatTrend(packageName) {
  const cached = MEMORY_CACHE.get(packageName);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const unavailable = {
    available: false,
    source: 'unavailable',
    total30d: 0,
    last7dAvg: 0,
    prev23dAvg: 0,
    trendRatio: 1,
    spikeDetected: false,
    collapseDetected: false,
    daily: {},
  };

  try {
    const params = new URLSearchParams({
      package: packageName,
      from: isoDate(30),
      until: isoDate(0),
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${NPM_STAT_API}?${params}`, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'mastyf-trust-scorer/1.0' },
    });
    clearTimeout(timer);

    if (!res.ok) {
      MEMORY_CACHE.set(packageName, { data: unavailable, ts: Date.now() });
      return unavailable;
    }

    const data = await res.json();
    const series = data?.[packageName];
    if (!series || typeof series !== 'object') {
      MEMORY_CACHE.set(packageName, { data: unavailable, ts: Date.now() });
      return unavailable;
    }

    // Sort dates ascending, drop today (always partial)
    const dates = Object.keys(series).sort();
    const today = isoDate(0);
    const usable = dates.filter((d) => d !== today);
    const counts = usable.map((d) => Number(series[d]) || 0);

    if (counts.length < 8) {
      MEMORY_CACHE.set(packageName, { data: unavailable, ts: Date.now() });
      return unavailable;
    }

    const total30d = counts.reduce((a, b) => a + b, 0);
    const last7 = counts.slice(-7);
    const prev23 = counts.slice(0, -7);
    const last7dAvg = last7.reduce((a, b) => a + b, 0) / Math.max(1, last7.length);
    const prev23dAvg = prev23.reduce((a, b) => a + b, 0) / Math.max(1, prev23.length);
    const trendRatio = prev23dAvg > 0 ? last7dAvg / prev23dAvg : (last7dAvg > 0 ? 10 : 1);

    const result = {
      available: true,
      source: 'npm-stat',
      total30d,
      last7dAvg: Math.round(last7dAvg),
      prev23dAvg: Math.round(prev23dAvg),
      trendRatio: Math.round(trendRatio * 100) / 100,
      // A spike only matters on packages with a real baseline
      spikeDetected: prev23dAvg >= 20 && trendRatio >= 4,
      collapseDetected: prev23dAvg >= 50 && trendRatio <= 0.15,
      daily: series,
    };
    MEMORY_CACHE.set(packageName, { data: result, ts: Date.now() });
    return result;
  } catch {
    MEMORY_CACHE.set(packageName, { data: unavailable, ts: Date.now() });
    return unavailable;
  }
}
