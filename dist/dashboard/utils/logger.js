import pino from 'pino';
/**
 * Detect if running as an MCP server (stdio transport).
 * In server mode, stdout is reserved for JSON-RPC frames.
 * ALL log output must go to stderr.
 */
export function detectMcpServerMode() {
    if (process.env['MASTYF_AI_MODE'] === 'server')
        return true;
    if (process.env['MASTYF_AI_MODE'] === 'cli')
        return false;
    if (process.env['MASTYF_AI_MODE'] === 'proxy')
        return true;
    const arg0 = process.argv[1] ?? '';
    const args = process.argv.join(' ');
    if (arg0.endsWith('index.js') || arg0.endsWith('index.ts'))
        return true;
    if (args.includes(' proxy') || args.endsWith(' proxy'))
        return true;
    return false;
}
export const IS_MCP_SERVER_MODE = detectMcpServerMode();
export const logger = pino({
    level: process.env['LOG_LEVEL']?.toLowerCase() ?? 'info',
    redact: {
        paths: [
            'req.headers.authorization',
            'req.headers["x-api-key"]',
            'apiKey',
            '*.token', '*.apiKey', '*.password', '*.secret', '*.privateKey',
        ],
        censor: '[REDACTED]',
    },
}, pino.destination({ fd: 2, sync: false }));
export class Logger {
    static debug(msg) { logger.debug(msg); }
    static info(msg) { logger.info(msg); }
    static warn(msg) { logger.warn(msg); }
    static error(msg) { logger.error(msg); }
}
// Backward-compatible LogLevel enum kept for existing consumers
export var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["DEBUG"] = 0] = "DEBUG";
    LogLevel[LogLevel["INFO"] = 1] = "INFO";
    LogLevel[LogLevel["WARN"] = 2] = "WARN";
    LogLevel[LogLevel["ERROR"] = 3] = "ERROR";
})(LogLevel || (LogLevel = {}));
