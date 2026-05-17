import { describe, it, expect } from 'vitest';
import { MTLS_HELM_MOUNT_PATHS, resolveMtlsEnvFromMounts } from '../../src/utils/mtls-config.js';

describe('mtls-config helm mounts', () => {
  it('exposes default Helm mount paths', () => {
    expect(MTLS_HELM_MOUNT_PATHS.ca).toBe('/etc/mcp-guardian/tls/ca.pem');
    expect(MTLS_HELM_MOUNT_PATHS.cert).toBe('/etc/mcp-guardian/tls/tls.crt');
    expect(MTLS_HELM_MOUNT_PATHS.key).toBe('/etc/mcp-guardian/tls/tls.key');
  });

  it('resolveMtlsEnvFromMounts is safe when files missing', () => {
    process.env.MCP_TLS_ENABLED = 'true';
    delete process.env.MCP_TLS_CA;
    resolveMtlsEnvFromMounts();
    expect(process.env.MCP_TLS_CA).toBeUndefined();
    delete process.env.MCP_TLS_ENABLED;
  });
});
