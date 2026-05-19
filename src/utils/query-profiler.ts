/**
 * Query profiler alias — wraps DB operations with slow-query logging.
 * @see db-performance-monitor.ts
 */
export {
  getSlowQueryThresholdMs,
  monitorDbQuery,
  monitorDbQueryAsync,
} from './db-performance-monitor.js';
