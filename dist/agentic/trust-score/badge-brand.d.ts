/** mastyf.ai badge branding — logo + name in all SVG badge layouts. */
export declare const BADGE_BRAND_NAME = "mastyf.ai";
export declare const BADGE_ALT_TEXT = "mastyf.ai security score";
/** Bump when badge artwork/branding changes — busts CDN and browser caches. */
export declare const BADGE_RENDERER_VERSION = "3";
/** Same-origin logo served from cloud public/ (resolves when SVG is loaded from /api/v1/badge/…). */
export declare const BADGE_LOGO_HREF = "/logo.jpeg";
type LogoVariant = 'on-dark' | 'on-light';
/** Real mastyf.ai logo (public/logo.jpeg). */
export declare function renderLogoImage(x: number, y: number, size: number): string;
/** Shield with checkmark — fallback when raster logo is unavailable. */
export declare function renderMastyfLogoMark(x: number, y: number, size: number, variant?: LogoVariant): string;
export type BrandLabelOpts = {
    labelW: number;
    h: number;
    fs: number;
    text?: string;
    logoOnly?: boolean;
};
/** Logo + brand text in the left shields segment (dark label background). */
export declare function renderBrandLabelSection(o: BrandLabelOpts): string;
/** Brand row for flat card badge (logo + name top-left). */
export declare function renderFlatBrandRow(x: number, y: number, fg: string): string;
export declare function brandAriaLabel(score: number, grade: string): string;
export declare function brandTitle(score: number, grade: string, packageName?: string): string;
export {};
//# sourceMappingURL=badge-brand.d.ts.map