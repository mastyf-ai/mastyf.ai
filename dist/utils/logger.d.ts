import pino from 'pino';
/**
 * Detect if running as an MCP server (stdio transport).
 * In server mode, stdout is reserved for JSON-RPC frames.
 * ALL log output must go to stderr.
 */
export declare function detectMcpServerMode(): boolean;
export declare const IS_MCP_SERVER_MODE: boolean;
export declare const logger: pino.Logger<never, boolean>;
export declare class Logger {
    static debug(msg: string): void;
    static info(msg: string): void;
    static warn(msg: string): void;
    static error(msg: string): void;
}
export declare enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}
//# sourceMappingURL=logger.d.ts.map