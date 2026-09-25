import { type TrustGrade } from './trust-badge-grade.js';
/** Visual badge layouts (shields.io-inspired). */
export type TrustBadgeStyle = 'flat' | 'github' | 'flat-square' | 'for-the-badge' | 'plastic' | 'social' | 'compact' | 'grade';
export type BadgeEmbedPlatform = 'github' | 'html' | 'rst' | 'bbcode' | 'asciidoc';
export type TrustBadgeStyleMeta = {
    id: TrustBadgeStyle;
    label: string;
    platform: string;
    description: string;
};
export declare const TRUST_BADGE_STYLES: TrustBadgeStyleMeta[];
export type TrustBadgeSvgInput = {
    score: number;
    grade?: TrustGrade | string;
    packageName?: string;
    style?: TrustBadgeStyle;
    label?: string;
};
export declare function normalizeBadgeStyle(raw: string | null | undefined): TrustBadgeStyle;
/** Render mastyf.ai security badge as SVG string. */
export declare function renderTrustBadgeSvg(input: TrustBadgeSvgInput): string;
/** Neutral badge when package is not certified. */
export declare function renderUncertifiedBadgeSvg(packageName?: string, style?: TrustBadgeStyle): string;
export declare function buildBadgeUrl(cloudBaseUrl: string, packageName: string, style?: TrustBadgeStyle): string;
export declare function buildRelativeBadgePath(packageName: string, style?: TrustBadgeStyle): string;
export declare function buildVerifyUrl(cloudBaseUrl: string, packageName: string): string;
export declare function buildBadgeEmbedMarkdown(opts: {
    cloudBaseUrl: string;
    packageName: string;
    style?: TrustBadgeStyle;
}): string;
export declare function buildBadgeEmbedHtml(opts: {
    cloudBaseUrl: string;
    packageName: string;
    style?: TrustBadgeStyle;
}): string;
export declare function buildBadgeEmbedRst(opts: {
    cloudBaseUrl: string;
    packageName: string;
    style?: TrustBadgeStyle;
}): string;
export declare function buildBadgeEmbedBbcode(opts: {
    cloudBaseUrl: string;
    packageName: string;
    style?: TrustBadgeStyle;
}): string;
export declare function buildBadgeEmbedAsciidoc(opts: {
    cloudBaseUrl: string;
    packageName: string;
    style?: TrustBadgeStyle;
}): string;
export type BadgeEmbedVariant = {
    style: TrustBadgeStyle;
    styleLabel: string;
    platform: BadgeEmbedPlatform;
    platformLabel: string;
    snippet: string;
    badgePath: string;
};
/** All style × platform embed snippets for UI copy panels. */
export declare function buildAllBadgeEmbeds(cloudBaseUrl: string, packageName: string): BadgeEmbedVariant[];
export declare function getDefaultGithubEmbed(cloudBaseUrl: string, packageName: string): string;
//# sourceMappingURL=trust-badge-svg.d.ts.map