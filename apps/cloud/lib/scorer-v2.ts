/**
 * Scorer v2 — enhanced scoring that combines API enrichers + scraped signals.
 * Falls back to v1 (package-scorer.ts) when scraped data is unavailable.
 */

import { scorePackageStatic, type ScoreResult, type Confidence } from './package-scorer';
import { readScrapedData, type ScrapedSignals } from './scraped-data-reader';

// ── Scraped dimension weights (v2 additions) ──
const SCRAPED_WEIGHTS = {
  readmeQuality: 0.12,
  communityHealth: 0.12,
  docsQuality: 0.10,
  securityHygiene: 0.08,
  reputation: 0.08,
};

// ── Combined weights (API + scraped) ──
const COMBINED_WEIGHTS: Record<string, number> = {
  cvePosture: 0.18,
  supplyChainIntegrity: 0.14,
  authStrength: 0.06,
  transportSecurity: 0.04,
  observedAttackHistory: 0.10,
  responseHygiene: 0.06,
  configurationFreshness: 0.08,
  abilityRiskSurface: 0.06,
  licenseRisk: 0.04,
  downloadHealth: 0.04,
  readmeQuality: 0.12,
  communityHealth: 0.12,
  docsQuality: 0.10,
  securityHygiene: 0.08,
  reputation: 0.08,
};

// ── Compute README quality from scraped data ──
function computeReadmeQuality(npm: ScrapedSignals['npm']): { score: number; confidence: Confidence } {
  let score = 0;

  // Length (0-30 points)
  if (npm.readme_length > 5000) score += 30;
  else if (npm.readme_length > 2000) score += 20;
  else if (npm.readme_length > 500) score += 10;
  else if (npm.readme_length > 0) score += 5;

  // Examples (0-25 points)
  if (npm.readme_has_examples) score += 25;

  // Install instructions (0-15 points)
  if (npm.readme_has_install_instructions) score += 15;

  // Badges (0-10 points, max 10)
  score += Math.min(10, npm.readme_has_badges * 2);

  // API docs (0-20 points)
  if (npm.readme_has_api_docs) score += 20;

  return { score: Math.min(100, score), confidence: 'verified' };
}

// ── Compute community health from scraped data ──
function computeCommunityHealth(
  github: ScrapedSignals['github'],
  community: ScrapedSignals['community'],
): { score: number; confidence: Confidence } {
  let score = 0;

  // Stars (0-30 points, logarithmic)
  if (github.stars > 10000) score += 30;
  else if (github.stars > 1000) score += 20;
  else if (github.stars > 100) score += 10;
  else if (github.stars > 10) score += 5;

  // Forks (0-15 points)
  if (github.forks > 1000) score += 15;
  else if (github.forks > 100) score += 10;
  else if (github.forks > 10) score += 5;

  // Recent activity (0-25 points)
  if (github.last_commit_days_ago <= 7) score += 25;
  else if (github.last_commit_days_ago <= 30) score += 15;
  else if (github.last_commit_days_ago <= 90) score += 5;

  // Commit frequency (0-15 points)
  if (github.commits_last_30d > 50) score += 15;
  else if (github.commits_last_30d > 20) score += 10;
  else if (github.commits_last_30d > 5) score += 5;

  // Star growth (0-15 points)
  if (community.github_stars_growth_30d > 1000) score += 15;
  else if (community.github_stars_growth_30d > 100) score += 10;
  else if (community.github_stars_growth_30d > 10) score += 5;

  return { score: Math.min(100, score), confidence: 'verified' };
}

// ── Compute docs quality from scraped data ──
function computeDocsQuality(github: ScrapedSignals['github']): { score: number; confidence: Confidence } {
  let score = 0;

  if (github.has_contributing_md) score += 25;
  if (github.has_code_of_conduct) score += 15;
  if (github.has_docs_dir) score += 30;
  if (github.has_examples_dir) score += 20;
  if (github.has_wiki) score += 10;

  return { score: Math.min(100, score), confidence: 'verified' };
}

// ── Compute security hygiene from scraped data ──
function computeSecurityHygiene(
  github: ScrapedSignals['github'],
  security: ScrapedSignals['security'],
): { score: number; confidence: Confidence } {
  let score = 0;

  if (github.has_security_md) score += 30;
  if (github.has_license_file) score += 20;
  if (github.has_ci) score += 25;
  if (github.has_issue_templates) score += 15;

  // Patch availability for known CVEs
  if (security.latest_version_patched) score += 10;

  return { score: Math.min(100, score), confidence: 'verified' };
}

// ── Compute reputation from scraped data ──
function computeReputation(
  community: ScrapedSignals['community'],
  github: ScrapedSignals['github'],
): { score: number; confidence: Confidence } {
  let score = 50; // base

  // Star growth trend
  if (community.npm_weekly_downloads_trend === 'up') score += 20;
  else if (community.npm_weekly_downloads_trend === 'down') score -= 10;

  // Stack Overflow mentions
  if (community.stackoverflow_mentions > 50) score += 15;
  else if (community.stackoverflow_mentions > 10) score += 10;
  else if (community.stackoverflow_mentions > 0) score += 5;

  // Star growth velocity
  if (community.github_stars_growth_30d > 500) score += 15;
  else if (community.github_stars_growth_30d > 50) score += 10;

  return { score: Math.min(100, Math.max(0, score)), confidence: 'verified' };
}

// ── Enhanced scoring with scraped data ──
export async function scorePackageV2(name: string): Promise<ScoreResult> {
  // Get base score from v1
  const baseResult = await scorePackageStatic(name);

  // Try to get scraped data
  const scraped = await readScrapedData(name);

  if (!scraped) {
    // No scraped data — return base result as-is
    return baseResult;
  }

  // Compute scraped dimensions
  const readmeResult = computeReadmeQuality(scraped.npm);
  const communityResult = computeCommunityHealth(scraped.github, scraped.community);
  const docsResult = computeDocsQuality(scraped.github);
  const securityResult = computeSecurityHygiene(scraped.github, scraped.security);
  const reputationResult = computeReputation(scraped.community, scraped.github);

  // Merge dimensions
  const allDimensions = {
    ...baseResult.dimensions,
    readmeQuality: readmeResult.score,
    communityHealth: communityResult.score,
    docsQuality: docsResult.score,
    securityHygiene: securityResult.score,
    reputation: reputationResult.score,
  };

  // Merge confidence maps
  const allConfidence = {
    ...baseResult.confidenceMap,
    readmeQuality: readmeResult.confidence,
    communityHealth: communityResult.confidence,
    docsQuality: docsResult.confidence,
    securityHygiene: securityResult.confidence,
    reputation: reputationResult.confidence,
  };

  // Calculate v2 weighted score
  let totalWeight = 0;
  let weightedSum = 0;
  for (const [dim, value] of Object.entries(allDimensions)) {
    let weight = COMBINED_WEIGHTS[dim] ?? 0.05;
    const conf = allConfidence[dim];
    if (conf === 'assumed') weight *= 0.7;
    if (conf === 'missing') weight *= 0.3;
    weightedSum += value * weight;
    totalWeight += weight;
  }

  let score = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : baseResult.score;

  // Keep provenance bonus from v1
  if (baseResult.score > score) {
    // Don't let v2 score be lower than v1 unless scraped data actively hurts
    score = Math.max(score, baseResult.score - 5);
  }

  // Add scraped dimension explanations
  const scrapedExplanations: Record<string, { score: number; explanation: string; confidence: Confidence; dataSources: string[] }> = {
    readmeQuality: {
      score: readmeResult.score,
      explanation: scraped.npm.readme_length > 2000
        ? `Comprehensive README (${scraped.npm.readme_length} chars) with${scraped.npm.readme_has_examples ? ' examples' : ''}${scraped.npm.readme_has_install_instructions ? ', install instructions' : ''}${scraped.npm.readme_has_api_docs ? ', API documentation' : ''}.`
        : scraped.npm.readme_length > 0
          ? `Basic README (${scraped.npm.readme_length} chars).`
          : 'No README found.',
      confidence: 'verified',
      dataSources: ['npm website (scraped)'],
    },
    communityHealth: {
      score: communityResult.score,
      explanation: `GitHub: ${scraped.github.stars} stars, ${scraped.github.forks} forks, ${scraped.github.commits_last_30d} commits in last 30 days.`,
      confidence: 'verified',
      dataSources: ['GitHub (scraped)'],
    },
    docsQuality: {
      score: docsResult.score,
      explanation: [
        scraped.github.has_contributing_md ? 'CONTRIBUTING.md' : null,
        scraped.github.has_code_of_conduct ? 'Code of Conduct' : null,
        scraped.github.has_docs_dir ? 'docs directory' : null,
        scraped.github.has_examples_dir ? 'examples directory' : null,
      ].filter(Boolean).join(', ') || 'No documentation files found.',
      confidence: 'verified',
      dataSources: ['GitHub (scraped)'],
    },
    securityHygiene: {
      score: securityResult.score,
      explanation: [
        scraped.github.has_security_md ? 'SECURITY.md present' : 'No SECURITY.md',
        scraped.github.has_ci ? 'CI/CD configured' : 'No CI detected',
        scraped.github.has_license_file ? 'License file present' : 'No license file',
      ].join(', ') + '.',
      confidence: 'verified',
      dataSources: ['GitHub (scraped)'],
    },
    reputation: {
      score: reputationResult.score,
      explanation: `Downloads trend: ${scraped.community.npm_weekly_downloads_trend}. ${scraped.community.stackoverflow_mentions} Stack Overflow mentions.`,
      confidence: 'verified',
      dataSources: ['npm website (scraped)', 'Stack Overflow (scraped)'],
    },
  };

  // Override the base result with enhanced data
  baseResult.score = score;
  baseResult.grade = computeGrade(score);
  baseResult.level = scoreToLevel(score);
  baseResult.dimensions = allDimensions;
  baseResult.confidenceMap = allConfidence;
  baseResult.dimensionExplanations = {
    ...baseResult.dimensionExplanations,
    ...scrapedExplanations,
  };

  return baseResult;
}

// ── Grade computation (local copy to avoid circular deps) ──
function computeGrade(score: number): string {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  if (score >= 20) return 'D';
  return 'F';
}

function scoreToLevel(score: number): string {
  if (score >= 90) return 'platinum';
  if (score >= 75) return 'gold';
  if (score >= 60) return 'silver';
  return 'bronze';
}
