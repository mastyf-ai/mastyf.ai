# Deploy to Vercel (quick)

Production URL (for now): **https://mastyf-ai-cloud.vercel.app**

## One-time setup

1. **Vercel token** — [vercel.com/account/tokens](https://vercel.com/account/tokens) → create token for team `mastyf-ai-gmailcoms-projects`.

2. **Neon Postgres** (required for login, scores, dashboard):
   - Create a free database at [neon.tech](https://neon.tech)
   - Copy the connection string (`postgresql://...`)

3. **Run migrations**:
   ```bash
   DATABASE_URL="postgresql://..." pnpm cloud:migrate:prod
   ```

## Deploy

```bash
export VERCEL_TOKEN="..."
export DATABASE_URL="postgresql://..."   # Neon — not localhost

pnpm cloud:deploy-now
```

This builds locally, syncs env vars to project `mastyf-ai-cloud`, and deploys to production.

**Code-only redeploy** (keep existing Vercel env):

```bash
VERCEL_TOKEN=... SKIP_ENV=1 pnpm cloud:deploy-now
```

## Verify

```bash
APP_URL=https://mastyf-ai-cloud.vercel.app pnpm cloud:verify-prod
```

## Production env vars (set automatically by deploy script)

| Variable | Example |
|----------|---------|
| `AUTH_URL` | `https://mastyf-ai-cloud.vercel.app` |
| `NEXT_PUBLIC_APP_URL` | same |
| `DATABASE_URL` | Neon connection string |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `LICENSE_JWT_SECRET` | same as `AUTH_SECRET` |
| `UPSTASH_REDIS_REST_URL` | Upstash / Vercel KV REST URL (trust score API rate limiting) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST token |

Do **not** set `AUTH_DEV_LOGIN=true` in production.

### Rate limiting (trust badge / deep-scan)

Link [Vercel KV](https://vercel.com/docs/storage/vercel-kv) or [Upstash Redis](https://upstash.com) to the project. The deploy script sets `UPSTASH_REDIS_REST_*` when `UPSTASH_REDIS_REST_URL` is exported locally.

Limits: **100 req/hour** (badge), **10 req/min** (deep-scan), **30 req/hour** (reports, certifications). Keys are per API key when `Authorization: Bearer …` is present, otherwise per client IP.

### Deep scan on Vercel (async worker)

Vercel serverless cannot spawn subprocesses for live MCP scans. Production flow:

1. `POST /api/v1/deep-scan/{package}` returns **202** with `jobId` and `pollUrl` (requires API key with `deep-scan:run` scope).
2. Run [`apps/cloud/scripts/deep-scan-worker.mjs`](../scripts/deep-scan-worker.mjs) on a long-lived Node host (Railway, K8s, VM) with the same `DATABASE_URL`.
3. Poll `GET /api/v1/deep-scan/jobs/{jobId}` until `status` is `done` or `failed`.

Apply migration `012_deep_scan_jobs.sql` via `pnpm cloud:migrate:prod`.

### Public website deep scan (sync mode)

For the **public score UI** (`Run deep scan` on `/certified/...`), enable synchronous live probes on Vercel:

| Variable | Value |
|----------|-------|
| `MASTYF_AI_ENABLE_DEEP_SCAN` | `true` |

This runs the live MCP probe in the serverless function (no worker). Rate limiting applies (**10 req/min** per IP). For high-volume or API-only deep scan, use the async worker flow above instead and omit this flag.

On Vercel, client IP comes from `x-vercel-forwarded-for` / `x-forwarded-for` (edge-injected, not client-spoofable). Self-hosted options:

| Variable | Purpose |
|----------|---------|
| `MASTYF_AI_TRUST_PROXY_HEADERS=true` | Trust `X-Forwarded-For` / `X-Real-IP` from your reverse proxy (configure proxy to strip client-supplied values) |
| `MASTYF_AI_RATE_LIMIT_PROXY_SECRET` | Require matching `X-Mastyf-Proxy-Secret` + `X-Mastyf-Client-IP` from your edge |
| `MASTYF_AI_TRUST_CLOUDFLARE=true` | Use `CF-Connecting-IP` when behind Cloudflare |

## Alternative: Vercel CLI login

```bash
npx vercel login
DATABASE_URL="postgresql://..." pnpm cloud:deploy-now
```

## Custom domain later

See [CUSTOM_DOMAIN.md](./CUSTOM_DOMAIN.md) for `www.mastyf.ai`.
