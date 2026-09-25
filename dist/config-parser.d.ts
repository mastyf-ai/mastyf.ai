import { McpServerConfig } from './types.js';
/**
 * Parses MCP configuration files from various clients.
 * Supports aggregation across multiple config files with deduplication.
 */
export declare class ConfigParser {
    /**
     * Find all known MCP config files on the system.
     */
    static findConfigPaths(): string[];
    /**
     * Parse a single MCP config file into an array of server configs.
     */
    static parse(filePath: string): McpServerConfig[];
    /**
     * Parse all discoverable configs, merge with deduplication, and return unified list.
     * First config file takes priority for servers with the same name.
     */
    static parseAll(): {
        servers: McpServerConfig[];
        sourcePaths: string[];
    };
}
//# sourceMappingURL=config-parser.d.ts.map