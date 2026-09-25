/**
 * Probes MCP server configurations for authentication and transport security.
 * Checks for API keys in environment variables, auth tokens in URLs, and
 * whether the transport is encrypted (HTTPS/WSS vs plain HTTP/WS).
 */
export class AuthProber {
    /**
     * Probe a server config for authentication and transport security status.
     */
    probe(server) {
        // Check for auth tokens in environment variables
        const authKeys = ['API_KEY', 'AUTH_TOKEN', 'MCP_API_KEY', 'SECRET', 'ACCESS_TOKEN', 'BEARER_TOKEN'];
        let hasAuth = false;
        let method;
        if (server.env) {
            for (const key of authKeys) {
                const value = server.env[key] ?? server.env[key.toLowerCase()] ?? server.env[key.toUpperCase()];
                if (typeof value === 'string' && value.trim().length > 0) {
                    hasAuth = true;
                    method = 'environment_variable';
                    break;
                }
            }
        }
        // Check for credentials in URL
        if (!hasAuth && server.url) {
            try {
                const parsed = new URL(server.url);
                if (parsed.username || parsed.password) {
                    hasAuth = true;
                    method = 'url_credentials';
                }
                // Check for auth query params
                const authParams = ['api_key', 'apikey', 'token', 'auth', 'key'];
                for (const param of authParams) {
                    if (parsed.searchParams.has(param)) {
                        hasAuth = true;
                        method = 'query_parameter';
                        break;
                    }
                }
            }
            catch {
                // Invalid URL — skip
            }
        }
        // Check transport encryption
        const isEncrypted = server.transport === 'stdio' // local pipe is fine
            || server.url?.startsWith('https://')
            || server.url?.startsWith('wss://')
            || false;
        return {
            hasAuthentication: hasAuth,
            method,
            isTransportEncrypted: isEncrypted,
        };
    }
}
//# sourceMappingURL=auth-prober.js.map