/** Default mastyf.ai cloud console URL for self-hosted MCP Guardian installs. */
export const DEFAULT_CLOUD_CONSOLE_URL = 'https://www.mastyf.ai';
export function defaultControlPlaneUrl() {
    return (process.env.MASTYF_AI_CONTROL_PLANE_URL?.trim()
        || process.env.MASTYF_AI_CLOUD_URL?.trim()
        || DEFAULT_CLOUD_CONSOLE_URL).replace(/\/$/, '');
}
//# sourceMappingURL=cloud-url.js.map