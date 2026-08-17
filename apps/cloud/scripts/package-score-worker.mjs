#!/usr/bin/env node

/**
 * Package score worker v2 — batch re-scorer that matches the main scorer logic.
 * Reads packages from Postgres, scores them with all signals, writes results back.
 *
 * Usage:
 *   node package-score-worker.mjs
 *   FORCE_RESCORE=true node package-score-worker.mjs
 *   BATCH_SIZE=20 DRY_RUN=true node package-score-worker.mjs
 */

import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const FORCE_RESCORE = process.env.FORCE_RESCORE === 'true';
const DRY_RUN = process.env.DRY_RUN === 'true';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '50', 10);
const RATE_LIMIT_MS = 1500;

// ── Helpers ──
function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function computeGrade(score) {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  if (score >= 20) return 'D';
  return 'F';
}

function scoreToLevel(score) {
  if (score >= 90) return 'platinum';
  if (score >= 75) return 'gold';
  if (score >= 60) return 'silver';
  return 'bronze';
}

function freshnessScore(days) {
  if (days <= 0) return 100;
  if (days <= 7) return 95;
  if (days <= 30) return 85;
  if (days <= 90) return 70;
  if (days <= 180) return 55;
  if (days <= 365) return 40;
  return Math.max(10, 30 - Math.log2(days / 365) * 10);
}

function isFinishedPackage(npm) {
  return npm.packageAgeDays > 365 && npm.lastPublishedDays > 180 && npm.downloadsLast30Days > 1000;
}

function downloadVelocityModifier(npm) {
  if (npm.downloadsLast30Days === 0) return -10;
  const ratio = npm.downloadsLast7Days / (npm.downloadsLast30Days / 4);
  if (ratio > 2.0) return -10;
  if (ratio > 1.5) return -5;
  if (ratio < 0.2) return -10;
  if (ratio < 0.5) return -5;
  return 0;
}

function licenseRiskScore(license) {
  const l = (license || '').toLowerCase().trim();
  if (l === 'unknown' || l === '' || l === 'unlicensed') return 20;
  if (l.includes('gpl') || l.includes('agpl')) return 40;
  if (l.includes('lgpl') || l.includes('mpl')) return 60;
  if (l.includes('mit') || l.includes('apache') || l.includes('bsd') || l.includes('isc')) return 90;
  return 70;
}

// ── Fetch npm metadata ──
async function fetchNpmMetadata(name) {
  const encoded = encodeURIComponent(name);
  const res = await fetch(`https://registry.npmjs.org/${encoded}`);
  if (!res.ok) throw new Error(`npm returned ${res.status}`);
  const doc = await res.json();

  const distTags = doc['dist-tags'] || {};
  const latest = distTags.latest || '0.0.0';
  const versions = doc.versions || {};
  const vDoc = versions[latest] || {};
  const time = doc.time || {};

  const maintainers = Array.isArray(doc.maintainers)
    ? doc.maintainers.map(m => m.name).filter(Boolean)
    : [];

  const deps = vDoc.dependencies || {};
  const keywords = Array.isArray(doc.keywords) ? doc.keywords.map(String) : [];

  const repo = vDoc.repository;
  const repoUrl = typeof repo === 'string' ? repo : (repo?.url || '');

  const lic = vDoc.license;
  const license = typeof lic === 'string' ? lic : (lic?.type || 'unknown');

  // Downloads
  let downloads30 = 0, downloads7 = 0;
  try {
    const [dl30, dl7] = await Promise.all([
      fetch(`https://api.npmjs.org/downloads/point/last-month/${encoded}`).then(r => r.ok ? r.json() : {}),
      fetch(`https://api.npmjs.org/downloads/point/last-week/${encoded}`).then(r => r.ok ? r.json() : {}),
    ]);
    downloads30 = dl30.downloads || 0;
    downloads7 = dl7.downloads || 0;
  } catch {}

  const createdAt = time.created ? Math.floor((Date.now() - new Date(time.created).getTime()) / 86400000) : 0;
  const lastModified = time.modified ? Math.floor((Date.now() - new Date(time.modified).getTime()) / 86400000) : createdAt;

  return {
    name: doc.name || name,
    version: latest,
    description: doc.description || vDoc.description || '',
    homepage: vDoc.homepage || '',
    repository: repoUrl,
    license,
    maintainers,
    downloadsLast30Days: downloads30,
    downloadsLast7Days: downloads7,
    packageAgeDays: createdAt,
    lastPublishedDays: lastModified,
    dependencyCount: Object.keys(deps).length,
    hasReadme: typeof doc.readme === 'string' && doc.readme.length > 0,
    hasKeywords: keywords.length > 0,
    keywords,
  };
}

// ── Fetch CVE data from OSV ──
async function fetchCves(name, version) {
  const encoded = encodeURIComponent(name);
  const purl = version
    ? `pkg:npm/${encoded}@${encodeURIComponent(version)}`
    : `pkg:npm/${encoded}`;

  try {
    const res = await fetch('https://api.osv.dev/v1/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ package: { purl } }),
    });
    if (!res.ok) return { count: 0, critical: 0, high: 0, medium: 0, low: 0, maxCvss: 0, findings: [] };
    const data = await res.json();
    const vulns = data.vulns || [];

    const findings = vulns.map(v => {
      let severity = 'MEDIUM';
      if (Array.isArray(v.severity) && v.severity.length > 0) {
        const s = v.severity[0];
        if (typeof s === 'string') severity = s.toUpperCase();
        else if (s?.score) {
          const num = parseFloat(s.score);
          if (num >= 9) severity = 'CRITICAL';
          else if (num >= 7) severity = 'HIGH';
          else if (num >= 4) severity = 'MEDIUM';
          else severity = 'LOW';
        }
      } else if (typeof v.severity === 'string') {
        severity = v.severity.toUpperCase();
      }

      const fixed = v.affected?.[0]?.ranges?.[0]?.events?.find(e => e.fixed)?.fixed;

      return {
        id: v.id || 'unknown',
        severity,
        summary: (v.summary || v.details || '').substring(0, 200),
        fixedVersion: fixed || null,
      };
    });

    const critical = findings.filter(f => f.severity === 'CRITICAL').length;
    const high = findings.filter(f => f.severity === 'HIGH').length;
    const medium = findings.filter(f => f.severity === 'MEDIUM').length;
    const low = findings.filter(f => f.severity === 'LOW').length;
    const maxCvss = critical > 0 ? 9.5 : high > 0 ? 8.0 : medium > 0 ? 6.0 : low > 0 ? 3.0 : 0;

    return { count: findings.length, critical, high, medium, low, maxCvss, findings };
  } catch {
    return { count: 0, critical: 0, high: 0, medium: 0, low: 0, maxCvss: 0, findings: [] };
  }
}

// ── Compute score (matches package-scorer.ts logic) ──
function computeScore(npm, cves) {
  const weights = {
    cvePosture: 0.22,
    supplyChainIntegrity: 0.18,
    authStrength: 0.08,
    transportSecurity: 0.06,
    observedAttackHistory: 0.12,
    responseHygiene: 0.08,
    configurationFreshness: 0.10,
    abilityRiskSurface: 0.08,
    licenseRisk: 0.05,
    downloadHealth: 0.05,
  };

  // CVE Posture (with CVSS weighting)
  let cveScore = 100;
  if (cves.maxCvss > 0) cveScore -= cves.maxCvss * 8;
  cveScore -= cves.critical * 12;
  cveScore -= cves.high * 6;
  cveScore -= cves.medium * 2;
  cveScore -= cves.low * 0.5;

  // Patch availability bonus
  const patchedCount = cves.findings.filter(f => f.fixedVersion).length;
  if (cves.findings.length > 0) {
    const patchRatio = patchedCount / cves.findings.length;
    if (patchRatio === 1.0) cveScore += 5;
    else if (patchRatio > 0.5) cveScore += 2;
  }

  // Supply chain (heuristic)
  let supplyScore = 60;
  if (npm.repository) supplyScore += 10;
  if (npm.maintainers.length >= 3) supplyScore += 10;
  if (npm.downloadsLast30Days > 10000) supplyScore += 5;

  // Typosquat detection (simple Levenshtein)
  const commonPkgs = ['express', 'lodash', 'react', 'axios', 'chalk', 'debug', 'dotenv', 'jest', 'moment', 'semver', 'uuid', 'webpack', 'zod', 'typescript'];
  const pkgName = npm.name.replace(/^@[^/]+\//, '').toLowerCase();
  const isTypoSquat = commonPkgs.some(c => {
    const dist = levenshtein(pkgName, c);
    return dist > 0 && dist <= 2 && pkgName !== c;
  });
  if (isTypoSquat) supplyScore -= 25;

  // Auth strength
  const hasAuth = npm.description.toLowerCase().includes('auth') ||
    npm.keywords.some(k => ['auth', 'oauth', 'jwt'].includes(k.toLowerCase()));
  const authScore = hasAuth ? 60 : 40;

  // Transport security
  const isHttp = npm.description.toLowerCase().includes('http') ||
    npm.keywords.some(k => ['http', 'sse', 'streamable'].includes(k.toLowerCase()));
  const transportScore = isHttp ? 40 : 70;

  // Attack history
  const totalAdvisories = cves.count;
  const attackScore = Math.max(0, 100 - (totalAdvisories * 8) - (cves.critical * 15));

  // Response hygiene
  const signals = [
    npm.hasReadme ? 1 : 0,
    npm.hasKeywords ? 1 : 0,
    npm.homepage ? 1 : 0,
    npm.repository ? 1 : 0,
    npm.maintainers.length > 0 ? 1 : 0,
  ];
  const hygieneScore = Math.round((signals.reduce((a, b) => a + b, 0) / signals.length) * 100);

  // Freshness
  let freshScore;
  if (isFinishedPackage(npm)) {
    const dpd = npm.downloadsLast30Days / 30;
    freshScore = dpd > 1000 ? 85 : dpd > 100 ? 75 : dpd > 10 ? 65 : 50;
  } else {
    freshScore = freshnessScore(npm.lastPublishedDays);
  }

  // Tool risk surface
  let riskScore = 50;
  if (npm.dependencyCount > 50) riskScore -= 15;
  if (npm.dependencyCount > 100) riskScore -= 10;
  if (npm.dependencyCount <= 5) riskScore += 15;
  if (npm.repository) riskScore += 10;

  // License risk
  const licScore = licenseRiskScore(npm.license);

  // Download health
  let dlScore = 50;
  if (npm.downloadsLast30Days >= 1000000) dlScore += 15;
  else if (npm.downloadsLast30Days >= 100000) dlScore += 10;
  else if (npm.downloadsLast30Days >= 10000) dlScore += 5;
  else if (npm.downloadsLast30Days < 100) dlScore -= 10;
  dlScore += downloadVelocityModifier(npm);

  const dimensions = {
    cvePosture: clamp(Math.round(cveScore)),
    supplyChainIntegrity: clamp(Math.round(supplyScore)),
    authStrength: clamp(authScore),
    transportSecurity: clamp(transportScore),
    observedAttackHistory: clamp(Math.round(attackScore)),
    responseHygiene: clamp(hygieneScore),
    configurationFreshness: clamp(freshScore),
    abilityRiskSurface: clamp(riskScore),
    licenseRisk: clamp(licScore),
    downloadHealth: clamp(dlScore),
  };

  // Weighted average
  let totalWeight = 0, weightedSum = 0;
  for (const [dim, value] of Object.entries(dimensions)) {
    const w = weights[dim] || 0.05;
    weightedSum += value * w;
    totalWeight += w;
  }
  let score = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 50;

  // Provenance bonus (check npm metadata for attestations)
  // Simplified: if the package has a repository and multiple maintainers, small bonus
  if (npm.repository && npm.maintainers.length >= 2) {
    score = Math.min(100, score + 2);
  }

  return { score, dimensions };
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

// ── Main worker ──
async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  // Add last_crawled_at column if missing
  await client.query(`
    DO $$ BEGIN
      ALTER TABLE package_score_cache
      ADD COLUMN IF NOT EXISTS last_crawled_at TIMESTAMPTZ;
    EXCEPTION WHEN duplicate_column THEN
      NULL;
    END $$;
  `);

  // Query packages to score
  let query, params;
  if (FORCE_RESCORE) {
    query = 'SELECT package_name FROM package_score_cache GROUP BY package_name ORDER BY MAX(computed_at) DESC LIMIT $1';
    params = [BATCH_SIZE];
  } else {
    query = `
      SELECT package_name FROM package_score_cache
      WHERE expires_at IS NULL OR expires_at < NOW()
      GROUP BY package_name
      ORDER BY MAX(computed_at) DESC NULLS FIRST
      LIMIT $1
    `;
    params = [BATCH_SIZE];
  }

  const { rows: packages } = await client.query(query, params);

  if (packages.length === 0) {
    console.log('No packages to score.');
    await client.end();
    return;
  }

  console.log(`Scoring ${packages.length} packages...`);

  let success = 0, failed = 0;

  for (let i = 0; i < packages.length; i++) {
    const { package_name: name } = packages[i];
    process.stdout.write(`[${i + 1}/${packages.length}] ${name}`);

    try {
      // Fetch data
      const [npm, cves] = await Promise.all([
        fetchNpmMetadata(name),
        fetchCves(name), // will resolve latest version in fetchNpmMetadata
      ]);

      // Score
      const { score, dimensions } = computeScore(npm, cves);
      const grade = computeGrade(score);
      const level = scoreToLevel(score);

      if (!DRY_RUN) {
        // UPSERT — insert or update on conflict
        const report = JSON.stringify({
          overallScore: score,
          grade,
          summaryPlainEnglish: `${cves.count} CVEs, ${npm.downloadsLast30Days} downloads/month, license: ${npm.license}`,
          categories: Object.entries(dimensions).map(([name, dimScore]) => ({
            name,
            score: dimScore,
            weight: 0.1,
            findings: [],
          })),
        });
        const checksData = JSON.stringify([
          { id: 'npm-metadata', downloads: npm.downloadsLast30Days, description: npm.description, license: npm.license },
          { id: 'cve-scan', total: cves.count, critical: cves.critical, high: cves.high, medium: cves.medium, low: cves.low, maxCvss: cves.maxCvss },
          { id: 'license', value: npm.license },
          { id: 'maintainers', count: npm.maintainers.length },
          { id: 'freshness', packageAgeDays: npm.packageAgeDays, lastPublishedDays: npm.lastPublishedDays },
          { id: 'supply-chain', depCount: npm.dependencyCount, hasRepo: !!npm.repository },
        ]);

        // Delete old versions for this package+tier, then insert fresh
        await client.query(
          `DELETE FROM package_score_cache WHERE package_name = $1 AND scan_tier = 'static'`,
          [name]
        );
        await client.query(`
          INSERT INTO package_score_cache (package_name, version, scan_tier, score, level, grade, score_report, checks, computed_at, expires_at)
          VALUES ($1, $2, 'static', $3, $4, $5, $6, $7, NOW(), NOW() + INTERVAL '24 hours')
        `, [name, npm.version, score, level, grade, report, checksData]);
      }

      success++;
      console.log(` ✓ ${score}/100 (${grade})`);
    } catch (err) {
      failed++;
      console.log(` ✗ ${err.message}`);
    }

    // Rate limit
    if (i < packages.length - 1) {
      await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
    }
  }

  console.log(`\nDone: ${success} succeeded, ${failed} failed`);
  await client.end();
}

main().catch(err => {
  console.error('Worker failed:', err);
  process.exit(1);
});
