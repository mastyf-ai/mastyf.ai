import { describe, expect, it } from 'vitest';
import {
  computeTrustGrade,
  trustGradeColor,
} from '../../src/agentic/trust-score/trust-badge-grade.js';
import {
  BADGE_ALT_TEXT,
  BADGE_BRAND_NAME,
  BADGE_LOGO_HREF,
  BADGE_RENDERER_VERSION,
} from '../../src/agentic/trust-score/badge-brand.js';
import {
  buildBadgeEmbedMarkdown,
  buildBadgeEmbedRst,
  buildBadgeUrl,
  normalizeBadgeStyle,
  renderTrustBadgeSvg,
  renderUncertifiedBadgeSvg,
  TRUST_BADGE_STYLES,
} from '../../src/agentic/trust-score/trust-badge-svg.js';

describe('trust-badge-grade', () => {
  it('maps score to letter grades', () => {
    expect(computeTrustGrade(95)).toBe('A+');
    expect(computeTrustGrade(82)).toBe('A');
    expect(computeTrustGrade(70)).toBe('B');
    expect(computeTrustGrade(55)).toBe('C');
    expect(computeTrustGrade(35)).toBe('D');
    expect(computeTrustGrade(10)).toBe('F');
  });

  it('returns grade colors', () => {
    expect(trustGradeColor('A+')).toBe('#00C853');
    expect(trustGradeColor('F')).toBe('#D50000');
  });
});

describe('trust-badge-svg', () => {
  it('renders flat card badge with logo and mastyf.ai', () => {
    const svg = renderTrustBadgeSvg({ score: 83, grade: 'A', packageName: '@test/pkg' });
    expect(svg).toContain('<svg');
    expect(svg).toContain('83');
    expect(svg).toContain('A');
    expect(svg).toContain(BADGE_BRAND_NAME);
    expect(svg).toContain(BADGE_LOGO_HREF);
    expect(svg).not.toContain('Guardian');
    expect(svg).toContain('@test/pkg');
  });

  it('renders for-the-badge style with mastyf.ai brand', () => {
    const svg = renderTrustBadgeSvg({ score: 60, style: 'for-the-badge' });
    expect(svg).toContain('60/100');
    expect(svg).toContain(BADGE_BRAND_NAME);
    expect(svg).toContain(BADGE_LOGO_HREF);
    expect(svg).not.toContain('Guardian');
  });

  it('renders github shields style with mastyf.ai', () => {
    const svg = renderTrustBadgeSvg({ score: 82, style: 'github' });
    expect(svg).toContain(BADGE_BRAND_NAME);
    expect(svg).toContain('82 | A');
  });

  it('renders all badge layout styles', () => {
    for (const meta of TRUST_BADGE_STYLES) {
      const svg = renderTrustBadgeSvg({ score: 75, style: meta.id });
      expect(svg).toContain('<svg');
      expect(svg).toContain('75');
    }
  });

  it('renders uncertified for github style', () => {
    const svg = renderUncertifiedBadgeSvg('@missing/pkg', 'github');
    expect(svg).toContain('not certified');
  });

  it('builds badge url with style query', () => {
    expect(buildBadgeUrl('https://cloud.test', '@acme/pkg', 'github')).toContain('style=github');
    expect(buildBadgeUrl('https://cloud.test', '@acme/pkg', 'flat')).toContain('style=flat');
    expect(buildBadgeUrl('https://cloud.test', '@acme/pkg', 'flat')).toContain(`v=${BADGE_RENDERER_VERSION}`);
  });

  it('normalizes unknown styles to flat', () => {
    expect(normalizeBadgeStyle('github')).toBe('github');
    expect(normalizeBadgeStyle('bogus')).toBe('flat');
  });

  it('builds markdown embed snippet', () => {
    const md = buildBadgeEmbedMarkdown({
      cloudBaseUrl: 'https://mastyf.ai',
      packageName: '@modelcontextprotocol/server-filesystem',
      style: 'github',
    });
    expect(md).toContain(`![${BADGE_ALT_TEXT}]`);
    expect(md).toContain('style=github');
    expect(md).toContain('/certified/');
  });

  it('builds rst embed snippet', () => {
    const rst = buildBadgeEmbedRst({
      cloudBaseUrl: 'https://mastyf.ai',
      packageName: '@acme/pkg',
      style: 'flat-square',
    });
    expect(rst).toContain('.. image::');
    expect(rst).toContain('style=flat-square');
  });
});
