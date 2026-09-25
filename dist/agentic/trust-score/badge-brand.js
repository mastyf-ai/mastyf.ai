/** mastyf.ai badge branding — logo + name in all SVG badge layouts. */
export const BADGE_BRAND_NAME = 'mastyf.ai';
export const BADGE_ALT_TEXT = 'mastyf.ai security score';
/** Bump when badge artwork/branding changes — busts CDN and browser caches. */
export const BADGE_RENDERER_VERSION = '3';
/** Same-origin logo served from cloud public/ (resolves when SVG is loaded from /api/v1/badge/…). */
export const BADGE_LOGO_HREF = '/logo.jpeg';
const BRAND_NAVY = '#1e3a5f';
const BRAND_GOLD = '#c9a227';
function escapeBrandXml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
/** Real mastyf.ai logo (public/logo.jpeg). */
export function renderLogoImage(x, y, size) {
    return `<image href="${BADGE_LOGO_HREF}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"/>`;
}
/** Shield with checkmark — fallback when raster logo is unavailable. */
export function renderMastyfLogoMark(x, y, size, variant = 'on-light') {
    const s = size;
    const shieldStroke = variant === 'on-dark' ? '#e8eef7' : BRAND_NAVY;
    const checkStroke = variant === 'on-dark' ? '#f5d76e' : BRAND_GOLD;
    return [
        `<g transform="translate(${x},${y})" aria-hidden="true">`,
        `<path d="M${s * 0.5} ${s * 0.06} L${s * 0.88} ${s * 0.26} V${s * 0.62} Q${s * 0.5} ${s * 0.94} ${s * 0.12} ${s * 0.62} V${s * 0.26} Z" fill="none" stroke="${shieldStroke}" stroke-width="${Math.max(1, s * 0.07)}"/>`,
        `<path d="M${s * 0.34} ${s * 0.46} L${s * 0.46} ${s * 0.6} L${s * 0.66} ${s * 0.34}" fill="none" stroke="${checkStroke}" stroke-width="${Math.max(1, s * 0.065)}" stroke-linecap="round" stroke-linejoin="round"/>`,
        `</g>`,
    ].join('');
}
/** Logo + brand text in the left shields segment (dark label background). */
export function renderBrandLabelSection(o) {
    const text = escapeBrandXml(o.text ?? BADGE_BRAND_NAME);
    const logoSize = Math.max(10, Math.round(o.h - 6));
    const logoX = 4;
    const logoY = (o.h - logoSize) / 2;
    if (o.logoOnly) {
        const lx = (o.labelW - logoSize) / 2;
        return renderLogoImage(lx, logoY, logoSize);
    }
    const textX = logoX + logoSize + 3;
    const ty = o.h * 0.68;
    return [
        renderLogoImage(logoX, logoY, logoSize),
        `<text x="${textX}" y="${ty}" fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="${Math.max(9, o.fs - 1)}" font-weight="600" text-anchor="start">${text}</text>`,
    ].join('');
}
/** Brand row for flat card badge (logo + name top-left). */
export function renderFlatBrandRow(x, y, fg) {
    const logoSize = 16;
    return [
        renderLogoImage(x, y - 2, logoSize),
        `<text x="${x + logoSize + 4}" y="${y + 10}" fill="${fg}" font-family="system-ui,Segoe UI,sans-serif" font-size="10" font-weight="700">${escapeBrandXml(BADGE_BRAND_NAME)}</text>`,
    ].join('');
}
export function brandAriaLabel(score, grade) {
    return `${BADGE_ALT_TEXT} ${score}/100 grade ${grade}`;
}
export function brandTitle(score, grade, packageName) {
    return `${BADGE_BRAND_NAME} — ${score}/100 (${grade})${packageName ? ` — ${packageName}` : ''}`;
}
//# sourceMappingURL=badge-brand.js.map