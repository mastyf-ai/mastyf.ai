import pino from 'pino';
import { Logger } from './logger.js';
import { getTraceLogFields } from './tracing.js';
import { redactEphemeralSecrets } from '../security/ephemeral-credential-vault.js';
/**
 * Structured JSON logger for enterprise SIEM ingestion.
 * Always writes to stderr — stdout is reserved for MCP JSON-RPC in proxy mode.
 */
const level = process.env.LOG_LEVEL || 'info';
const logger = pino({
    level: level.toLowerCase(),
    formatters: {
        level(label) {
            return { level: label };
        },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
}, pino.destination({ fd: 2, sync: false }));
function withTraceCorrelation(entry) {
    const merged = { ...entry, ...getTraceLogFields() };
    if (typeof merged === 'object' && merged !== null && 'message' in merged && typeof merged.message === 'string') {
        merged.message = redactEphemeralSecrets(merged.message);
    }
    return merged;
}
function logObject(levelFn, msg) {
    if (typeof msg === 'string') {
        levelFn(withTraceCorrelation({ message: msg }));
        return;
    }
    levelFn(withTraceCorrelation(msg));
}
/**
 * Recursively sanitizes data structures for BigQuery and SIEM export.
 * BigQuery does not support nested arrays (lists of lists / ARRAY<ARRAY<T>>).
 * Any array containing another array is safely transformed so inner arrays are serialized to JSON strings.
 */
export function sanitizeForLogIngestion(value) {
    if (value === null || value === undefined)
        return value;
    if (Array.isArray(value)) {
        if (value.some((item) => Array.isArray(item))) {
            return value.map((item) => (Array.isArray(item) ? JSON.stringify(item) : sanitizeForLogIngestion(item)));
        }
        return value.map((item) => sanitizeForLogIngestion(item));
    }
    if (typeof value === 'object') {
        const sanitizedObj = {};
        for (const [k, v] of Object.entries(value)) {
            sanitizedObj[k] = sanitizeForLogIngestion(v);
        }
        return sanitizedObj;
    }
    return value;
}
export class StructuredLogger {
    static logPolicyDecision(entry) {
        const rawArgs = entry.context?.arguments;
        const sanitizedEntry = {
            ...entry,
            context: entry.context
                ? {
                    ...entry.context,
                    arguments: {},
                    arguments_json: rawArgs ? JSON.stringify(rawArgs) : '{}',
                }
                : entry.context,
        };
        logger.info(withTraceCorrelation(sanitizedEntry));
        import('./enterprise-bootstrap.js').then(({ exportSiemEvent }) => {
            exportSiemEvent('policy_decision', withTraceCorrelation(sanitizedEntry)).catch((e) => {
                Logger.error(`[structured-logger] SIEM export failed: ${e instanceof Error ? e.message : String(e)}`);
            });
        }).catch((e) => {
            Logger.error(`[structured-logger] enterprise-bootstrap import failed: ${e instanceof Error ? e.message : String(e)}`);
        });
    }
    static logBlocked(entry) {
        logger.warn(withTraceCorrelation(entry));
        import('./enterprise-bootstrap.js').then(({ exportSiemEvent }) => {
            exportSiemEvent('tool_blocked', withTraceCorrelation(entry)).catch((e) => {
                Logger.error(`[structured-logger] SIEM export failed: ${e instanceof Error ? e.message : String(e)}`);
            });
        }).catch((e) => {
            Logger.error(`[structured-logger] enterprise-bootstrap import failed: ${e instanceof Error ? e.message : String(e)}`);
        });
    }
    static logError(entry) {
        logger.error(withTraceCorrelation(entry));
    }
    static info(msg) {
        logObject((obj) => logger.info(obj), msg);
    }
    static warn(msg) {
        logObject((obj) => logger.warn(obj), msg);
    }
    static debug(msg) {
        logObject((obj) => logger.debug(obj), msg);
    }
}
//# sourceMappingURL=structured-logger.js.map