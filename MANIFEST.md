# mastyf.ai — Authentication & RBAC delivery manifest

All files are inside `mastyf-ai-auth-rbac-delivery.zip`, under `auth-rbac-delivery/`,
mirroring their exact destination path inside your `mastyf.ai/` repo root. Copy each
file to the matching path shown below (overwrite where noted as "MODIFIED").

## 1. New backend files (copy as-is)

| Path | Purpose |
|---|---|
| `src/database/migrations/020-auth-rbac.sql` | PostgreSQL schema: users, roles, permissions, groups, sessions, audit_logs, settings, setup_state. Seeds 5 system roles + permission catalog. |
| `src/auth/db/auth-schema.sqlite.ts` | SQLite DDL mirror + shared permission/role seed data (used by both backends). |
| `src/auth/db/auth-db.ts` | Dual-backend (SQLite/Postgres) query adapter, selected via `DB_TYPE`. |
| `src/auth/password.ts` | Argon2id hashing, password-policy validation, random password generator. |
| `src/auth/rbac-types.ts` | Shared TypeScript types for the whole subsystem. |
| `src/auth/user-store.ts` | User CRUD, lockout counters, password/status mutations. |
| `src/auth/role-store.ts` | Role CRUD, permission catalog, role↔user/group assignment. |
| `src/auth/group-store.ts` | Group CRUD, membership, group↔role assignment. |
| `src/auth/rbac-engine.ts` | Resolves a user's effective permissions (direct roles ∪ group roles) and legacy `DashboardRole` tier. |
| `src/auth/session-store.ts` | DB-backed sessions: hashed tokens, CSRF secret pairing, sliding expiry, revoke. |
| `src/auth/audit-log.ts` | Audit log writer/query. |
| `src/auth/auth-settings-store.ts` | Persisted password/lockout/session-timeout settings (admin-editable). |
| `src/auth/setup-state.ts` | Tracks one-time initial-setup completion. |
| `src/auth/auth-middleware.ts` | `attachAuthContext`, `requireAuth`, `requirePermission()`, cookie/CSRF helpers. |
| `src/auth/auth-routes.ts` | Every `/api/auth/*`, `/api/users*`, `/api/groups*`, `/api/roles*`, `/api/permissions`, `/api/audit-logs`, `/api/settings/auth` route. |

## 2. Modified backend files

| Path | Change |
|---|---|
| `src/soc-api-server.ts` | Added `attachAuthContext` middleware, `registerAuthRoutes(app)`, and a global `requireAuth` gate for every `/api/*` route except an explicit public allowlist (`/api/auth/setup*`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/status`, `/api/auth/csrf`, `/api/login`, `/api/logout`, `/api/health`). Removed the old always-`authenticated:true` open-core stub and the no-op `/api/login`/`/api/logout` handlers. Added `MASTYF_AI_AUTH_DISABLED` escape hatch (see env vars). |
| `package.json` | Added `"argon2": "^0.41.1"` dependency. |

## 3. New frontend files (deploy/dashboard-spa)

| Path | Purpose |
|---|---|
| `app/components/InitialSetup.tsx` | First-admin creation screen. |
| `app/components/AccessDenied.tsx` | Reusable inline "access denied" card. |
| `app/access-denied/page.tsx` | Standalone `/access-denied` route (same component, full page). |
| `app/components/UsersPanel.tsx` | User list/create/edit/delete/reset-password/lock/disable UI. |
| `app/components/GroupsPanel.tsx` | Group CRUD + membership + role assignment UI. |
| `app/components/RolesPanel.tsx` | Role CRUD with per-permission checkboxes (system roles read-only). |
| `app/components/SecuritySettingsPanel.tsx` | Password policy / lockout policy / session timeout editor. |
| `app/components/AuditLogPanel.tsx` | Paginated, filterable audit log viewer. |
| `app/components/ProfilePanel.tsx` | Self-service: change password, active sessions, login history. |
| `lib/auth-admin-api.ts` | Typed API client for every new endpoint (setup, users, groups, roles, sessions, audit, settings). |

## 4. Modified frontend files

| Path | Change |
|---|---|
| `lib/mastyf-ai-api.ts` | Extended `AuthStatus` type with `setupRequired` and `permissions` fields (backward compatible — all new fields optional). |
| `lib/dashboard-roles.ts` | Added `can()` / `canAny()` fine-grained permission checks alongside the existing coarse `hasPermission()` tier check. |
| `lib/workspace-nav.ts` | Added `users`, `groups`, `roles`, `security`, `audit-log`, `profile` to `SettingsView` and to the Settings workspace's sub-nav. |
| `app/components/LoginGate.tsx` | Branches to `<InitialSetup/>` when `status.setupRequired` is true, before showing the login form. |
| `app/components/operations/ConfigurationHub.tsx` | Wired the six new views to the new panels, each gated by the matching fine-grained permission (falls back to `<AccessDenied/>`). |

> Note: `app/components/AdminPanel.tsx` already existed in your repo but is **not wired into any route** (dead code, pre-existing). I left it untouched — the live "Administration" settings tab is `ConfigurationHub.tsx`, which is what I extended.

## 5. Migration commands

**PostgreSQL** (if `DB_TYPE=postgres`): migration `020-auth-rbac.sql` is picked up automatically by the existing `migration-runner.ts` the next time the server starts (same mechanism as migrations 002–019). No manual command needed beyond starting the app; to run it standalone ahead of time:
```bash
psql "$DATABASE_URL" -f src/database/migrations/020-auth-rbac.sql
```

**SQLite** (default, `DB_TYPE` unset or `sqlite`): no manual migration step — `src/auth/db/auth-db.ts` runs the equivalent `CREATE TABLE IF NOT EXISTS` DDL from `auth-schema.sqlite.ts` automatically on first use, against the same DB file resolved by `resolveMastyfAiDbPath()`.

## 6. Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `MASTYF_AI_AUTH_DISABLED` | No | `false` | Set to `true` only for local/dev to fully restore the old open-core (no-login) behavior. **Do not set in production.** |
| `AUTH_ARGON2_MEMORY_KB` | No | `19456` (19 MB) | Argon2id memory cost. Raise on servers with more RAM for stronger hashing. |
| `AUTH_ARGON2_TIME_COST` | No | `2` | Argon2id iteration count. |
| `AUTH_ARGON2_PARALLELISM` | No | `1` | Argon2id parallelism (lanes). |
| `DATABASE_URL` | Only if `DB_TYPE=postgres` | — | Already used by `PostgresDatabase`; the new auth pool reuses the same variable. |
| `DB_TYPE` | No | `sqlite` | Already existing — `sqlite` or `postgres`, selects the auth backend too. |
| `NODE_ENV=production` | Recommended | — | Already existing — makes session/CSRF cookies `Secure`. |

No new required secrets: session tokens and CSRF secrets are generated per-session with `crypto.randomBytes`, not from an env var.

## 7. Manual steps after applying the changes

1. `npm install` (or `pnpm install`) at the repo root to pull in `argon2`.
2. `argon2` ships prebuilt native bindings for common platforms; if your build/deploy image is unusual (e.g. Alpine musl, ARM), confirm `npm install` completes without falling back to a source build that needs a C++ toolchain. If it does need to compile, make sure `python3`/`make`/`g++` are present in that image (or use a `node:*-bullseye`-based image instead of `alpine`).
3. Start the server once against your target database. On first boot:
   - SQLite: tables are created automatically.
   - Postgres: run migration 020 (auto via `migration-runner.ts`, or manually per §5).
4. Visit the dashboard. With no users in the database yet, you'll land on **Initial Setup** — create the first Administrator account there. This flow is permanently disabled afterward (`auth_setup_state.completed = true`).
5. Log in as that admin, then go to **Settings → Users / Groups / Roles / Security Settings** to create additional accounts, groups, and custom roles, and to tune the password/lockout/session policy away from the defaults (12-char minimum, 5 failed attempts → 15 min lockout, 60 min idle session timeout) if desired.
6. If you run multiple `soc-api-server` replicas behind a load balancer, sessions are already shared correctly as long as they point at the same Postgres/SQLite backend (SQLite in multi-replica setups needs a shared volume, same as the rest of the app's existing SQLite usage — this isn't a new constraint, it already applies to `history-db.ts`).
7. Existing API-key-based access (`X-API-Key` header) used by the security-swarm and CLI tooling is untouched — only the **browser dashboard session** path now requires login. If any automation was relying on the old always-`authenticated:true` stub for `/api/auth/status`, it will now see `authenticated: false` until it either logs in or you set `MASTYF_AI_AUTH_DISABLED=true`.
8. CI/tests: no existing test files were modified. New modules have no test coverage yet — recommended follow-up (not included here) is unit tests for `validatePasswordAgainstPolicy`, `resolveUserAccess`, and an integration test hitting `/api/auth/setup` → `/api/auth/login` → a protected route, plus a CSRF-rejection test. I did not add these given the scope of this pass — flagging so they don't get silently skipped.

## 8. Design notes / what I deliberately reused vs. added

- **Reused, not replaced:** `DashboardRole`/`hasPermission()` coarse tier gating already used throughout the SPA keeps working unchanged — every DB role carries a `dashboardTier` that maps onto it. Fine-grained `permissions.<key>` checks are additive, only used by the new panels.
- **Reused:** the SPA's existing `mastyfAiFetch`, `fetchAuthStatus`, `fetchCsrfToken`, `loginDashboard`, `logoutDashboard`, `/api/login`, `/api/logout`, `/api/auth/status`, `/api/auth/csrf` contracts — the backend now serves real data through those exact same shapes/paths instead of the old always-true stub, so `LoginGate.tsx` needed only a small extension (the setup-flow branch), not a rewrite.
- **Reused:** the existing CORS middleware, `X-Mastyf-Ai-Tenant`/`X-Tenant-Id` tenant header convention, and the `card`/`btn`/`badge`/`input` design system — no new UI kit introduced.
- **Added:** everything DB-backed (users/groups/roles/permissions/sessions/audit/settings) — none of that existed before; the prior `dashboard-auth.ts`/`dashboard-rbac.ts` in `src/auth/` were env/API-key-driven with no persisted users, and are left in place (still used by other entry points, e.g. control-plane) rather than deleted, per "do not rewrite the application."

## 9. Known follow-ups worth doing before a real production rollout

- Add the automated tests described in §7 step 8.
- Wire `sessionAbsoluteTimeoutMinutes` from `AuthSettings` into `sessionStore.create()`'s `ttlMinutes` (currently only `sessionTimeoutMinutes` is used as the single expiry; the settings type has a separate absolute-timeout field for future idle-vs-absolute distinction — right now they're effectively the same value).
- Consider rate-limiting `/api/auth/login` at the IP level (the app already has `ingress-rate-limit.ts`/`client-rate-limit.ts` utilities elsewhere in `src/proxy/` — hooking one of those in front of the login route would harden against distributed brute force beyond the per-account lockout already implemented).
- MFA is modeled in settings (`requireMfaForAdmins`) but not implemented — it's a settings flag today with no enforcement, included so the schema doesn't need to change later.
