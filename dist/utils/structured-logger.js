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
export class StructuredLogger {
    static logPolicyDecision(entry) {
        logger.info(withTraceCorrelation(entry));
        import('./enterprise-bootstrap.js').then(({ exportSiemEvent }) => {
            exportSiemEvent('policy_decision', withTraceCorrelation(entry)).catch((e) => {
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