import { BADGE_ALT_TEXT, BADGE_BRAND_NAME, BADGE_RENDERER_VERSION, brandAriaLabel, brandTitle, renderBrandLabelSection, renderFlatBrandRow, renderLogoImage, } from './badge-brand.js';
import { computeTrustGrade, trustGradeColor, trustGradeTextColor, } from './trust-badge-grade.js';
export const TRUST_BADGE_STYLES = [
    { id: 'github', label: 'GitHub README', platform: 'GitHub', description: 'shields.io two-part badge — ideal for README.md' },
    { id: 'flat-square', label: 'Flat square', platform: 'GitHub · GitLab', description: 'Compact flat-square corners (20px)' },
    { id: 'for-the-badge', label: 'For the Badge', platform: 'GitHub', description: 'Classic For the Badge layout' },
    { id: 'flat', label: 'Card', platform: 'Docs · npm', description: 'Rounded card with package name' },
    { id: 'plastic', label: 'Plastic', platform: 'Websites', description: 'Gradient plastic shields style' },
    { id: 'social', label: 'Social', platform: 'Twitter · LinkedIn', description: 'Wide badge for social / profile links' },
    { id: 'compact', label: 'Compact', platform: 'Comments · Issues', description: 'Minimal inline badge' },
    { id: 'grade', label: 'Grade pill', platform: 'Any', description: 'Large letter grade with score' },
];
const SHIELDS_FONT = 'Verdana,DejaVu Sans,sans-serif';
const UI_FONT = 'system-ui,Segoe UI,sans-serif';
function escapeXml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
export function normalizeBadgeStyle(raw) {
    const s = (raw || 'flat').toLowerCase();
    if (TRUST_BADGE_STYLES.some((m) => m.id === s))
        return s;
    return 'flat';
}
function renderShieldsTwoPart(o) {
    const w = o.labelW + o.msgW;
    const gradId = `pg-${Math.random().toString(36).slice(2, 8)}`;
    const labelFill = o.plastic ? `url(#${gradId}-l)` : '#555';
    const msgFill = o.plastic ? `url(#${gradId}-m)` : o.messageBg;
    const defs = o.plastic
        ? `<defs>
      <linearGradient id="${gradId}-l" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#666"/><stop offset="100%" stop-color="#444"/></linearGradient>
      <linearGradient id="${gradId}-m" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${o.messageBg}"/><stop offset="100%" stop-color="${shadeColor(o.messageBg, -18)}"/></linearGradient>
    </defs>`
        : '';
    const labelInner = renderBrandLabelSection({
        labelW: o.labelW,
        h: o.h,
        fs: o.fs,
        text: o.labelText,
        logoOnly: o.logoOnly,
    });
    const clipId = `${gradId}-clip`;
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${o.h}" viewBox="0 0 ${w} ${o.h}" role="img" aria-label="${escapeXml(o.aria)}">`,
        `<title>${escapeXml(o.title)}</title>`,
        defs,
        `<clipPath id="${clipId}"><rect x="0" y="0" width="${o.labelW}" height="${o.h}"/></clipPath>`,
        `<rect width="${w}" height="${o.h}" rx="${o.rx}" fill="#333"/>`,
        `<rect x="0" width="${o.labelW}" height="${o.h}" rx="${o.rx}" fill="${labelFill}"/>`,
        o.rx === 0 ? `<rect x="${o.labelW}" width="${o.msgW}" height="${o.h}" fill="${msgFill}"/>` : `<rect x="${o.labelW}" width="${o.msgW}" height="${o.h}" rx="${o.rx}" fill="${msgFill}"/>`,
        `<g clip-path="url(#${clipId})">${labelInner}</g>`,
        `<text x="${o.labelW + o.msgW / 2}" y="${o.h * 0.68}" fill="${o.messageFg}" font-family="${SHIELDS_FONT}" font-size="${o.fs}" font-weight="bold" text-anchor="middle">${escapeXml(o.message)}</text>`,
        '</svg>',
    ].join('');
}
function shadeColor(hex, amount) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m)
        return hex;
    const n = parseInt(m[1], 16);
    const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amount));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount));
    const b = Math.max(0, Math.min(255, (n & 255) + amount));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
/** Render mastyf.ai security badge as SVG string. */
export function renderTrustBadgeSvg(input) {
    const score = Math.max(0, Math.min(100, Math.round(input.score)));
    const grade = input.grade ?? computeTrustGrade(score);
    const style = input.style ?? 'flat';
    const bg = trustGradeColor(grade);
    const fg = trustGradeTextColor(grade);
    const msg = `${score}/100 · ${grade}`;
    const aria = brandAriaLabel(score, grade);
    const title = brandTitle(score, grade, input.packageName);
    switch (style) {
        case 'github':
            return renderShieldsTwoPart({
                message: `${score} | ${grade}`,
                messageBg: bg,
                messageFg: fg,
                labelW: 108,
                msgW: 72,
                h: 20,
                rx: 3,
                fs: 11,
                labelText: BADGE_BRAND_NAME,
                aria,
                title,
            });
        case 'flat-square':
            return renderShieldsTwoPart({
                message: `${score} | ${grade}`,
                messageBg: bg,
                messageFg: fg,
                labelW: 108,
                msgW: 72,
                h: 20,
                rx: 0,
                fs: 11,
                labelText: BADGE_BRAND_NAME,
                aria,
                title,
            });
        case 'for-the-badge':
            return renderShieldsTwoPart({
                message: msg,
                messageBg: bg,
                messageFg: fg,
                labelW: 128,
                msgW: 160,
                h: 28,
                rx: 4,
                fs: 11,
                labelText: BADGE_BRAND_NAME,
                aria,
                title,
            });
        case 'plastic':
            return renderShieldsTwoPart({
                message: `${score} · ${grade}`,
                messageBg: bg,
                messageFg: fg,
                labelW: 108,
                msgW: 88,
                h: 28,
                rx: 4,
                fs: 11,
                plastic: true,
                labelText: BADGE_BRAND_NAME,
                aria,
                title,
            });
        case 'social':
            return renderShieldsTwoPart({
                message: `${score}/100 (${grade})`,
                messageBg: bg,
                messageFg: fg,
                labelW: 132,
                msgW: 120,
                h: 32,
                rx: 6,
                fs: 12,
                labelText: 'mastyf.ai score',
                aria,
                title,
            });
        case 'compact':
            return renderShieldsTwoPart({
                message: `${score}`,
                messageBg: bg,
                messageFg: fg,
                labelW: 22,
                msgW: 36,
                h: 18,
                rx: 2,
                fs: 10,
                logoOnly: true,
                aria,
                title,
            });
        case 'grade': {
            const w = 132;
            const h = 40;
            return [
                `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeXml(aria)}">`,
                `<title>${escapeXml(title)}</title>`,
                `<rect width="${w}" height="${h}" rx="8" fill="${bg}"/>`,
                renderLogoImage(6, 10, 20),
                `<text x="30" y="28" fill="${fg}" font-family="${UI_FONT}" font-size="22" font-weight="800">${escapeXml(String(grade))}</text>`,
                `<text x="72" y="18" fill="${fg}" opacity="0.9" font-family="${UI_FONT}" font-size="9" font-weight="600">${BADGE_BRAND_NAME}</text>`,
                `<text x="72" y="32" fill="${fg}" font-family="${UI_FONT}" font-size="14" font-weight="700">${score}/100</text>`,
                '</svg>',
            ].join('');
        }
        default: {
            const w = 220;
            const h = 36;
            const pkg = input.packageName ? escapeXml(input.packageName.slice(0, 28)) : '';
            return [
                `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeXml(aria)}">`,
                `<title>${escapeXml(title)}</title>`,
                `<rect width="${w}" height="${h}" rx="6" fill="${bg}"/>`,
                renderFlatBrandRow(10, 6, fg),
                pkg
                    ? `<text x="12" y="28" fill="${fg}" opacity="0.85" font-family="${UI_FONT}" font-size="8">${pkg}</text>`
                    : '',
                `<text x="${w - 12}" y="22" fill="${fg}" font-family="${UI_FONT}" font-size="14" font-weight="700" text-anchor="end">${score}</text>`,
                `<text x="${w - 12}" y="32" fill="${fg}" opacity="0.9" font-family="${UI_FONT}" font-size="9" text-anchor="end">/100 · ${escapeXml(String(grade))}</text>`,
                '</svg>',
            ].join('');
        }
    }
}
/** Neutral badge when package is not certified. */
export function renderUncertifiedBadgeSvg(packageName, style = 'flat') {
    const neutral = '#94a3b8';
    const title = `Not certified${packageName ? ` — ${packageName}` : ''}`;
    if (style === 'github' || style === 'flat-square' || style === 'for-the-badge' || style === 'plastic' || style === 'social' || style === 'compact') {
        return renderShieldsTwoPart({
            message: 'not certified',
            messageBg: neutral,
            messageFg: '#fff',
            labelW: style === 'compact' ? 22 : style === 'social' ? 132 : style === 'for-the-badge' ? 128 : 108,
            msgW: style === 'compact' ? 80 : style === 'social' ? 100 : style === 'for-the-badge' ? 100 : 100,
            h: style === 'social' ? 32 : style === 'for-the-badge' || style === 'plastic' ? 28 : style === 'compact' ? 18 : 20,
            rx: style === 'flat-square' ? 0 : style === 'compact' ? 2 : style === 'for-the-badge' ? 4 : 3,
            fs: style === 'social' ? 12 : style === 'compact' ? 10 : 11,
            plastic: style === 'plastic',
            logoOnly: style === 'compact',
            labelText: style === 'social' ? 'mastyf.ai score' : BADGE_BRAND_NAME,
            aria: `${BADGE_BRAND_NAME} — not certified`,
            title,
        });
    }
    if (style === 'grade') {
        return [
            `<svg xmlns="http://www.w3.org/2000/svg" width="132" height="40" viewBox="0 0 132 40" role="img" aria-label="Not certified">`,
            `<title>${escapeXml(title)}</title>`,
            `<rect width="132" height="40" rx="8" fill="${neutral}"/>`,
            renderLogoImage(8, 10, 20),
            `<text x="34" y="26" fill="#fff" font-family="${UI_FONT}" font-size="11" font-weight="700">Not certified</text>`,
            '</svg>',
        ].join('');
    }
    const w = 220;
    const h = 36;
    const pkg = packageName ? escapeXml(packageName.slice(0, 28)) : '';
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Not certified">`,
        `<title>${escapeXml(title)}</title>`,
        `<rect width="${w}" height="${h}" rx="6" fill="${neutral}"/>`,
        renderFlatBrandRow(10, 6, '#fff'),
        `<text x="12" y="28" fill="#fff" opacity="0.85" font-family="${UI_FONT}" font-size="8">${pkg || 'Not certified'}</text>`,
        `<text x="${w - 12}" y="22" fill="#fff" font-family="${UI_FONT}" font-size="12" font-weight="700" text-anchor="end">—</text>`,
        '</svg>',
    ].join('');
}
export function buildBadgeUrl(cloudBaseUrl, packageName, style) {
    const base = cloudBaseUrl.replace(/\/$/, '');
    const pkg = encodeURIComponent(packageName);
    const normalized = style ?? 'flat';
    return `${base}/api/v1/badge/${pkg}?style=${encodeURIComponent(normalized)}&v=${BADGE_RENDERER_VERSION}`;
}
export function buildRelativeBadgePath(packageName, style) {
    const pkg = encodeURIComponent(packageName);
    const normalized = style ?? 'flat';
    return `/api/v1/badge/${pkg}?style=${encodeURIComponent(normalized)}&v=${BADGE_RENDERER_VERSION}`;
}
export function buildVerifyUrl(cloudBaseUrl, packageName) {
    return `${cloudBaseUrl.replace(/\/$/, '')}/certified/${encodeURIComponent(packageName)}`;
}
export function buildBadgeEmbedMarkdown(opts) {
    const badgeUrl = buildBadgeUrl(opts.cloudBaseUrl, opts.packageName, opts.style);
    const verifyUrl = buildVerifyUrl(opts.cloudBaseUrl, opts.packageName);
    return `[![${BADGE_ALT_TEXT}](${badgeUrl})](${verifyUrl})`;
}
export function buildBadgeEmbedHtml(opts) {
    const badgeUrl = buildBadgeUrl(opts.cloudBaseUrl, opts.packageName, opts.style);
    const verifyUrl = buildVerifyUrl(opts.cloudBaseUrl, opts.packageName);
    return `<a href="${verifyUrl}"><img src="${badgeUrl}" alt="${BADGE_ALT_TEXT}" /></a>`;
}
export function buildBadgeEmbedRst(opts) {
    const badgeUrl = buildBadgeUrl(opts.cloudBaseUrl, opts.packageName, opts.style);
    const verifyUrl = buildVerifyUrl(opts.cloudBaseUrl, opts.packageName);
    return `.. image:: ${badgeUrl}\n   :target: ${verifyUrl}\n   :alt: ${BADGE_ALT_TEXT}`;
}
export function buildBadgeEmbedBbcode(opts) {
    const badgeUrl = buildBadgeUrl(opts.cloudBaseUrl, opts.packageName, opts.style);
    const verifyUrl = buildVerifyUrl(opts.cloudBaseUrl, opts.packageName);
    return `[url=${verifyUrl}][img]${badgeUrl}[/img][/url]`;
}
export function buildBadgeEmbedAsciidoc(opts) {
    const badgeUrl = buildBadgeUrl(opts.cloudBaseUrl, opts.packageName, opts.style);
    const verifyUrl = buildVerifyUrl(opts.cloudBaseUrl, opts.packageName);
    return `image:${badgeUrl}[link="${verifyUrl}",alt="${BADGE_ALT_TEXT}"]`;
}
const PLATFORM_BUILDERS = {
    github: buildBadgeEmbedMarkdown,
    html: buildBadgeEmbedHtml,
    rst: buildBadgeEmbedRst,
    bbcode: buildBadgeEmbedBbcode,
    asciidoc: buildBadgeEmbedAsciidoc,
};
const PLATFORM_LABELS = {
    github: 'GitHub / Markdown',
    html: 'HTML',
    rst: 'reStructuredText',
    bbcode: 'BBCode',
    asciidoc: 'AsciiDoc',
};
/** All style × platform embed snippets for UI copy panels. */
export function buildAllBadgeEmbeds(cloudBaseUrl, packageName) {
    const variants = [];
    for (const meta of TRUST_BADGE_STYLES) {
        for (const platform of Object.keys(PLATFORM_BUILDERS)) {
            const snippet = PLATFORM_BUILDERS[platform]({
                cloudBaseUrl,
                packageName,
                style: meta.id,
            });
            variants.push({
                style: meta.id,
                styleLabel: meta.label,
                platform,
                platformLabel: PLATFORM_LABELS[platform],
                snippet,
                badgePath: buildRelativeBadgePath(packageName, meta.id),
            });
        }
    }
    return variants;
}
export function getDefaultGithubEmbed(cloudBaseUrl, packageName) {
    return buildBadgeEmbedMarkdown({ cloudBaseUrl, packageName, style: 'github' });
}
//# sourceMappingURL=trust-badge-svg.js.map