# Disaster recovery runbook

Operational procedures for MCP Guardian audit stores, Redis, and secrets.

## Targets (suggested)

| Metric | Target | Notes |
|--------|--------|-------|
| **RPO** | ≤ 15 min | SQLite file snapshot or Postgres PITR |
| **RTO** | ≤ 60 min | Redeploy proxy + restore DB + Redis warm |

Tune per your compliance tier.

---

## SQLite backup and restore

**Backup (hot, WAL-safe):**

```bash
sqlite3 "$MCP_GUARDIAN_DB_PATH" ".backup '/backups/guardian-$(date +%Y%m%d-%H%M).db'"
```

Or stop proxy and copy the file + `-wal` / `-shm` siblings.

**Restore:**

1. Stop all Guardian processes using the DB
2. Replace `MCP_GUARDIAN_DB_PATH` with backup
3. If using `GUARDIAN_DB_ENCRYPTION_KEY`, use the **same** key as at backup time
4. Start proxy; run `mcp-guardian doctor`

---

## PostgreSQL backup and restore

- **Logical:** `pg_dump "$DATABASE_URL" -Fc -f guardian.dump`
- **Restore:** `pg_restore -d "$DATABASE_URL" --clean --if-exists guardian.dump`
- Migrations: applied automatically on startup via `schema_migrations` ([migration-runner](../src/database/migration-runner.ts))

After restore, verify `mcp-guardian fleet status` and dashboard audit tabs.

---

## Redis

Redis holds **ephemeral** state: rate-limit counters, DPoP jti, session cache, LLM cache.

| Action | Effect |
|--------|--------|
| `FLUSHDB` / failover without persistence | Rate limits reset; DPoP replay window may reset; sessions invalidated |
| Full loss | No audit history loss (audit is SQLite/PG) |

**Do not** treat Redis as source of truth for compliance audit.

Reconfigure: `REDIS_URL` / Sentinel / Cluster per [REDIS_HA.md](./REDIS_HA.md). Use `rediss://` or `GUARDIAN_REDIS_TLS=true` in production.

---

## Key rotation

### DPoP / session (Redis-backed)

1. Deploy new Redis AUTH password if applicable
2. Rolling restart Guardian pods — clients obtain new tokens from IdP
3. Old jti entries expire per TTL

### Dashboard JWT / API key

1. Issue new `DASHBOARD_JWT_SECRET` or `DASHBOARD_API_KEY` in secret manager
2. Rolling restart dashboard + proxy
3. Invalidate old sessions (users re-login)

### MCP / OAuth client secrets

Rotate at identity provider; update server env in `mcp.json` / Helm values.

### `GUARDIAN_DB_ENCRYPTION_KEY`

Field-encrypted rows cannot be read with a different key. Plan:

1. Export audit with old key attached
2. Set new key
3. Re-import or run maintenance script to re-encrypt columns

SQLCipher: use official rekey workflow.

---

## GDPR — erase all audit data

```typescript
import { HistoryDatabase } from '@mcp-guardian/server';

const db = new HistoryDatabase();
const counts = db.eraseAllAuditData();           // all tenants
// db.eraseAllAuditData('acme-corp');           // single tenant
```

Also purge:

- Central SIEM / log aggregator
- Postgres `unified_*` tables if `GUARDIAN_AUDIT_SYNC_ENABLED`
- Exported reports on object storage

Document erasure in your ROPA; retention default 30 days (`HistoryDatabase` purge TTL).

---

## Failure scenarios

| Scenario | Response |
|----------|----------|
| Corrupt SQLite | Restore from backup; last resort `eraseAllAuditData` + accept data loss |
| Postgres unavailable | Proxy may degrade; enable `GUARDIAN_STRICT_MODE` only when DB required |
| Redis down | Rate limits fall back to local LRU; DPoP strict mode may block — see [PRODUCTION_BLOCKERS.md](./PRODUCTION_BLOCKERS.md) |
| Policy mis-deploy | Roll back ConfigMap / `default-policy.yaml`; use `policy-audit` mode |

---

## Kubernetes backup CronJob (SQLite)

When the proxy stores audit data on a PVC, schedule hot backups with `sqlite3 .backup` (WAL-safe):

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: mcp-guardian-sqlite-backup
  namespace: mcp-guardian
spec:
  schedule: "*/15 * * * *"
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: backup
              image: alpine:3.20
              command:
                - /bin/sh
                - -ec
                - |
                  apk add --no-cache sqlite
                  ts=$(date +%Y%m%d-%H%M)
                  sqlite3 "$MCP_GUARDIAN_DB_PATH" ".backup /backups/guardian-${ts}.db"
              env:
                - name: MCP_GUARDIAN_DB_PATH
                  value: /data/guardian.db
                - name: GUARDIAN_DB_ENCRYPTION_KEY
                  valueFrom:
                    secretKeyRef:
                      name: mcp-guardian-secrets
                      key: db-encryption-key
              volumeMounts:
                - name: data
                  mountPath: /data
                - name: backups
                  mountPath: /backups
          volumes:
            - name: data
              persistentVolumeClaim:
                claimName: mcp-guardian-data
            - name: backups
              persistentVolumeClaim:
                claimName: mcp-guardian-backups
```

Mount the same `GUARDIAN_DB_ENCRYPTION_KEY` used by the proxy Deployment. Restore per [SQLite backup and restore](#sqlite-backup-and-restore) above.

---

## Verification after recovery

```bash
mcp-guardian doctor --policy default-policy.yaml
pnpm test   # or CI smoke
curl -s http://localhost:9090/healthz
curl -s http://localhost:9090/readyz
```

---

## Related docs

- [ENCRYPTION_AT_REST.md](./ENCRYPTION_AT_REST.md)
- [REDIS_HA.md](./REDIS_HA.md)
- [COMPLIANCE.md](./COMPLIANCE.md)
- [SCALE_AND_RESILIENCE.md](./SCALE_AND_RESILIENCE.md)
