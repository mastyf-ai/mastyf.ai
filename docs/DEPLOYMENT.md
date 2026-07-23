# Deploying Mastyf.ai

## Quick Start — Local Development

```bash
git clone https://github.com/mastyf-ai/mastyf.ai.git && cd mastyf.ai
pnpm install && pnpm build
node dist/cli.js start
```
Dashboard: http://localhost:4000

## Docker

```bash
docker run --rm -d --name mastyf \
  -p 4000:4000 \
  -v $(pwd)/default-policy.yaml:/app/default-policy.yaml \
  -v $(pwd)/mastyf-ai-configs:/app/mastyf-ai-configs \
  -v mastyf-data:/data \
  -e DASHBOARD_AUTH_DISABLED=true \
  -e OLLAMA_BASE_URL=http://host.docker.internal:11434 \
  -e MASTYF_AI_DB_PATH=/data/history.db \
  --add-host host.docker.internal:host-gateway \
  ghcr.io/mastyf-ai/mastyf:latest
```

## Docker Compose

```bash
# Single proxy + Redis
docker compose -f deploy/docker-compose.yml up -d

# With cloud control plane
docker compose -f deploy/docker-compose.yml --profile split-plane up -d
```

## Kubernetes (Helm)

```bash
helm repo add mastyf-ai https://charts.mastyf.ai
helm install mastyf-ai mastyf-ai/mastyf-ai \
  -f deploy/helm/mastyf-ai/values.yaml \
  --set dashboard.auth.disabled=true
```

For high availability (3 replicas, Postgres, PgBouncer):
```bash
helm install mastyf-ai mastyf-ai/mastyf-ai \
  -f deploy/helm/mastyf-ai/values-ha.yaml
```

## Air-Gapped Deployment

```bash
# Build offline bundle
node scripts/build-offline-bundle.mjs --output mastyf-bundle.tar.gz

# Transfer to air-gapped host
scp mastyf-bundle.tar.gz airgap-host:

# Deploy
tar -xzf mastyf-bundle.tar.gz -C /opt/mastyf/
export DASHBOARD_PORT=4000 DASHBOARD_AUTH_DISABLED=true MASTYF_AI_DB_PATH=/opt/mastyf/data/history.db
node /opt/mastyf/dist/cli.js proxy --policy /opt/mastyf/policies/default-policy.yaml
```

## Cloud Control Plane

Deploy to Vercel:
```bash
cd apps/cloud
vercel --prod
```

Or self-host:
```bash
cd apps/cloud
DATABASE_URL=postgres://... pnpm build && pnpm start
```

Then configure self-hosted proxies:
```bash
export MASTYF_AI_CONTROL_PLANE_URL=https://your-cloud.vercel.app
export MASTYF_AI_CLOUD_API_KEY=gcp_your-api-key
```

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `DASHBOARD_PORT` | Dashboard port | 4000 |
| `DASHBOARD_AUTH_DISABLED` | Disable auth (dev only) | false |
| `MASTYF_AI_DB_PATH` | SQLite path | ~/.mastyf-ai/history.db |
| `DATABASE_URL` | PostgreSQL (HA mode) | none |
| `REDIS_URL` | Redis (distributed rate limiting) | none |
| `OLLAMA_BASE_URL` | Ollama endpoint | http://localhost:11434 |
| `MASTYF_AI_LLM_ENABLED` | Enable LLM scanning | false |
| `MASTYF_AI_LLM_MODEL` | LLM model | qwen3:8b |
| `MASTYF_AI_SEMANTIC_TIMEOUT_MS` | Semantic scan timeout | 500 |
| `MASTYF_AI_DB_ENCRYPTION_KEY` | AES-256-GCM key | none |
| `MASTYF_AI_CONTROL_PLANE_URL` | Cloud URL | none |
| `MASTYF_AI_CLOUD_API_KEY` | Cloud API key | none |
| `MASTYF_AI_SLACK_WEBHOOK` | Slack notifications | none |
| `ALERT_PAGERDUTY_KEY` | PagerDuty routing key | none |
| `MASTYF_AI_ALLOWED_REGIONS` | Geo-fencing regions | none |
| `MASTYF_AI_ACCESS_HOURS` | Access hours (e.g. 8-18) | none |
| `MASTYF_AI_ALERT_BLOCK_RATE_THRESHOLD` | Alert on spike | 50/min |
