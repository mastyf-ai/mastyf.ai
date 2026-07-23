# Cloud Deploy Rollback Runbook

## Vercel rollback

1. Open Vercel project → Deployments
2. Promote previous production deployment
3. Or: `vercel rollback` with production token

## Database migration rollback

1. If migration failed mid-deploy, restore Neon/Postgres snapshot
2. Re-run `pnpm --filter @mastyf_ai/cloud db:migrate` against known-good schema

## Verification

```bash
APP_URL=https://www.mastyf.ai ./scripts/verify-pro-production.sh
```

## CI gate

Production deploy requires GitHub Environment `production` approval on `cloud-deploy.yml`.
