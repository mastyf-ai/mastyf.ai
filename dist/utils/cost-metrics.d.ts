import type { ProxyCallRecord } from '../types.js';
/** Hours spanned by call record timestamps (minimum 1 minute). */
export declare function recordsTimeSpanHours(records: ProxyCallRecord[]): number;
export declare function computeBurnRatePerHour(costUsd: number, records: ProxyCallRecord[]): number;
export declare function computeProjectedMonthly(costUsd: number, records: ProxyCallRecord[]): number;
//# sourceMappingURL=cost-metrics.d.ts.map