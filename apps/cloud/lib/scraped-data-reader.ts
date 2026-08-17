/**
 * Scraped data reader — reads JSON files from the Python crawler output
 * and provides typed access to scraped signals.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';

export type ScrapedSignals = {
  package_name: string;
  crawled_at: string;
  crawl_version: number;
  npm: {
    readme_length: number;
    readme_has_examples: boolean;
    readme_has_badges: number;
    readme_has_install_instructions: boolean;
    readme_has_api_docs: boolean;
    weekly_downloads_display: string;
    maintainer_count: number;
    license_displayed: string;
    repository_link: string | null;
    homepage_link: string | null;
  };
  github: {
    stars: number;
    forks: number;
    open_issues: number;
    has_security_md: boolean;
    has_contributing_md: boolean;
    has_code_of_conduct: boolean;
    has_ci: boolean;
    has_license_file: boolean;
    has_docs_dir: boolean;
    has_examples_dir: boolean;
    last_commit_days_ago: number;
    commits_last_30d: number;
    has_wiki: boolean;
    has_issue_templates: boolean;
  };
  community: {
    npm_weekly_downloads_trend: 'up' | 'down' | 'stable';
    stackoverflow_mentions: number;
    github_stars_growth_30d: number;
  };
  security: {
    cve_contexts: Array<{
      cve_id: string;
      has_exploit: boolean;
      has_patch: boolean;
      patched_in_version: string | null;
    }>;
    latest_version_patched: boolean;
  };
};

const DATA_DIR = join(process.cwd(), 'crawler', 'data');

// ── Read scraped data for a package ──
export async function readScrapedData(packageName: string): Promise<ScrapedSignals | null> {
  // Normalize package name for filename (replace @ and / with safe chars)
  const safeName = packageName.replace(/^@/, '').replace(/\//g, '__');
  const filePath = join(DATA_DIR, `${safeName}.json`);

  try {
    const data = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data) as ScrapedSignals;

    // Validate basic structure
    if (!parsed.package_name || !parsed.crawled_at) {
      return null;
    }

    // Check freshness: reject if older than 7 days
    const crawledAt = new Date(parsed.crawled_at);
    const ageMs = Date.now() - crawledAt.getTime();
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
    if (ageMs > maxAgeMs) {
      return null; // stale data
    }

    return parsed;
  } catch {
    return null; // file doesn't exist or is invalid
  }
}

// ── Check if scraped data is available ──
export async function hasScrapedData(packageName: string): Promise<boolean> {
  const data = await readScrapedData(packageName);
  return data !== null;
}

// ── List all scraped packages ──
export async function listScrapedPackages(): Promise<string[]> {
  const { readdir } = await import('fs/promises');
  try {
    const files = await readdir(DATA_DIR);
    return files
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', '').replace(/__/g, '/'));
  } catch {
    return [];
  }
}

// ── Get scrape freshness info ──
export async function getScrapeInfo(packageName: string): Promise<{
  available: boolean;
  crawledAt: string | null;
  ageHours: number | null;
  isStale: boolean;
} | null> {
  const safeName = packageName.replace(/^@/, '').replace(/\//g, '__');
  const filePath = join(DATA_DIR, `${safeName}.json`);

  try {
    const data = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data) as ScrapedSignals;
    const crawledAt = new Date(parsed.crawled_at);
    const ageMs = Date.now() - crawledAt.getTime();
    const ageHours = Math.round(ageMs / (1000 * 60 * 60));
    const isStale = ageMs > 7 * 24 * 60 * 60 * 1000;

    return {
      available: true,
      crawledAt: parsed.crawled_at,
      ageHours,
      isStale,
    };
  } catch {
    return null;
  }
}
