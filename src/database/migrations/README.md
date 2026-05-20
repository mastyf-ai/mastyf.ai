# Database migrations

## PostgreSQL (production)

`migration-runner.ts` applies **only `*.sql` files** in this directory in lexicographic order, tracked in `schema_migrations`.

Current SQL migrations:

| File | Purpose |
|------|---------|
| `002-unified-aggregation.sql` | Unified aggregation tables |
| `003-attack-learning-shared.sql` | Shared attack-learning state |
| `004-tenant-scoping.sql` | Tenant columns |
| `005-tenant-cost-security-health.sql` | Cost/security/health tenant scope |
| `006-query-indexes.sql` | Query indexes |

Base schema for PostgreSQL is created inline in `postgres-db.ts` before SQL migrations run.

## Legacy SQLite

`001_initial.ts` and `003_metrics_timeseries.ts` are **SQLite-only** helpers used by the embedded DB path. They are **not** executed by the PostgreSQL runner.
