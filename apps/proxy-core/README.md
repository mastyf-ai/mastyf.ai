# Experimental split-plane data plane

**Not production-hardened.** Use the TypeScript proxy (`src/proxy/http-proxy-server.ts`) for enterprise deployments.

This Go service is optional (`docker compose --profile split-plane`). Configure:

- `PROXY_CORE_API_KEY` — require `X-Proxy-Core-Api-Key` or `Authorization: Bearer` on ingress
- `PROXY_CORE_MAX_BODY_BYTES` — default 10 MiB (`http.MaxBytesReader`)
