export declare function isDashboardQueryCacheEnabled(): boolean;
export declare function dashboardQueryCacheKey(parts: Record<string, string | number>): string;
export declare function getCachedDashboardQuery<T>(key: string): Promise<T | null>;
export declare function setCachedDashboardQuery(key: string, value: unknown): Promise<void>;
export declare function cachedDashboardQuery<T>(key: string, loader: () => Promise<T>): Promise<T>;
/** @internal */
export declare function resetDashboardQueryCacheForTests(): void;
//# sourceMappingURL=dashboard-query-cache.d.ts.map