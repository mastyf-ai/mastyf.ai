# mTLS (mutual TLS) — status and roadmap

## Current status

| Capability | Status |
|---|---|
| Proxy ↔ upstream mTLS (`MCP_TLS_*` env) | **Implemented** — see `src/utils/mtls-config.ts` |
| Certificate load at process start | **Implemented** |
| Hot-reload on cert rotation | **Not implemented** |
| Helm chart mTLS volume mounts | **Placeholder** — values commented; requires pod restart |
| `MtlsCertWatcher` file watcher | **Skeleton** — logs change; does not reload agent |

mTLS credentials are read once when the proxy starts. Rotating CA, client certificate, or key files requires restarting the MCP Guardian process (or Kubernetes pod).

## Configuration (runtime)

```bash
MCP_TLS_ENABLED=true
MCP_TLS_CA=/path/to/ca.pem
MCP_TLS_CERT=/path/to/client-cert.pem
MCP_TLS_KEY=/path/to/client-key.pem
# MCP_TLS_REJECT_UNAUTHORIZED=false  # dev only
```

CLI equivalents: `mcp-guardian proxy --mtls --mtls-ca … --mtls-cert … --mtls-key …`

## Kubernetes / Helm

The Helm chart does **not** yet mount TLS secrets or wire `MCP_TLS_*` automatically. Example placeholders in `deploy/helm/mcp-guardian/values.yaml` document intent only.

**Until hot-reload ships:** after rotating certificates in a Secret, roll the Deployment:

```bash
kubectl rollout restart deployment/<release-name>-mcp-guardian
```

## Roadmap

1. **v2.6** — Helm: optional `mtls.existingSecret` volume mount + env wiring (placeholder → functional).
2. **v2.6+** — `MtlsCertWatcher` triggers agent rebuild on `fs.watch` events (in-process reload).
3. **Future** — SIGHUP / admin API to reload TLS without full process exit.

## Related

- [SECURITY.md](../SECURITY.md) — threat model and reporting
- [deploy/PRODUCTION.md](../deploy/PRODUCTION.md) — production deployment
