/**
 * Extract geo/time context from proxy HTTP headers for zero-trust scoring (C3).
 */
import type { IncomingHttpHeaders } from 'http';
export interface RequestGeoContext {
    geoRegion?: string;
    hourUtc: number;
}
export declare function extractRequestGeoContext(headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>): RequestGeoContext;
export declare function applyGeoToCallContext<T extends Record<string, unknown>>(ctx: T, headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>): T & RequestGeoContext;
//# sourceMappingURL=request-geo-context.d.ts.map