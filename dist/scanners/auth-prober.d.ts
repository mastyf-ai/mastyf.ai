import { McpServerConfig, AuthStatus } from '../types.js';
/**
 * Probes MCP server configurations for authentication and transport security.
 * Checks for API keys in environment variables, auth tokens in URLs, and
 * whether the transport is encrypted (HTTPS/WSS vs plain HTTP/WS).
 */
export declare class AuthProber {
    /**
     * Probe a server config for authentication and transport security status.
     */
    probe(server: McpServerConfig): AuthStatus;
}
//# sourceMappingURL=auth-prober.d.ts.map