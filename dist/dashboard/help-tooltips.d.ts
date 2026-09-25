/**
 * Centralized Help Tooltip Registry
 *
 * Provides structured, educational explanations for all dashboard features
 * when the user hovers over the '?' icon beside any element.
 */
export interface HelpTooltipItem {
    id: string;
    title: string;
    short: string;
    detailed: string;
    learnMorePath?: string;
    category: 'protection' | 'activity' | 'policy' | 'servers' | 'threat-lab' | 'cost' | 'security' | 'general';
}
export declare const HELP_TOOLTIPS: Record<string, HelpTooltipItem>;
/**
 * Returns the tooltip item for a given ID, or a fallback item if not found.
 */
export declare function getHelpTooltip(id: string): HelpTooltipItem;
//# sourceMappingURL=help-tooltips.d.ts.map