# Changelog

All notable changes to MCP Guardian will be documented in this file.

## [Unreleased]

## [2.8.4] - 2026-05-19

Enterprise hardening, tiered concurrent benchmarks, and proxy/SSE/WebSocket improvements (see `172abcd`).

### Fixed
- **SSE proxy** — `evaluateAsync()` for Redis rate limits and OPA; mTLS upstream via `createMtlsAgent()`.
- **Multi-replica attack learning** — PostgreSQL `ai_attack_learning_state_shared` via `AuditTrailSync`; file fallback when DB sync disabled.
- **Semantic layer visibility** — `semantic_layer_degraded` structured log + dashboard `logs:alert`; `GUARDIAN_SEMANTIC_STRICT` blocks when LLM unavailable.
- **Per-request proxy state** — `ProxyRequestContextStore` keyed by JSON-RPC id (concurrent `tools/call` safe).
- **GDPR erasure** — `eraseAllAuditData()` already purges `cost_records`, `security_scans`, `health_checks` (tests retained).
- **Postmark secret FP** — context-aware `postmark-api-token` matching.
- **PowerShell guards** — `Invoke-Expression`, `-EncodedCommand`, `[Convert]::FromBase64String` in shell tokenizer + policy path.
- **HTML entity normalization** — tests for `&lt;` / numeric entities in payload normalizer.

### Added
- **Migration runner** — `schema_migrations` table; ordered SQL in `src/database/migrations/`; wired into `postgres-db` and `AuditTrailSync`.
- **WebSocket MCP proxy** — foundational `WebSocketProxyServer` (JSON-RPC forward + policy on `tools/call`).
- **Dashboard API rate limiting** — Redis or in-process LRU (`GUARDIAN_DASHBOARD_API_RATE_LIMIT`, default 120/min).
- **Per-tenant circuit breakers** — `getCircuitBreaker(tenantId, serverName)` registry.
- **Load smoke test** — `benchmarks/concurrent-tool-calls.ts`.

### Environment
| Variable | Default | Purpose |
|----------|---------|---------|
| `GUARDIAN_SEMANTIC_STRICT` | `false` | Block `tools/call` when async semantic LLM unavailable |
| `GUARDIAN_DASHBOARD_API_RATE_LIMIT` | `120` | Dashboard REST API requests per minute per IP |
| `GUARDIAN_TENANT_ID` | `default` | Tenant isolation for circuit breakers, rate limits, attack learning PG row |

## [2.8.3] - 2026-05-18

### Documentation
- **Fig 4 omitted** from README — `fig4-cdf-time-to-suggestion.png` is a degenerate CDF (one point per category); use median time-to-suggestion in the metrics table instead.
- Removed **synthetic ROI** narrative and **CHART_10** references from README and related docs (prefer repo `reports/attack-learning-eval/metrics.json` for CI-aligned numbers).

## [2.8.2] - 2026-05-18

### Documentation
- Integrated **sca/** security & compliance analysis collateral into project docs — [sca/README.md](sca/README.md) index, chart catalog, and relationship to core proxy learning.
- Expanded [docs/AI_LEARNING.md](docs/AI_LEARNING.md) with evaluation methodology (`pnpm eval:attack-learning*`), figure interpretation (repo `fig1–fig7` + `sca/CHART_*`), and operational recommendations.
- Added [Attack learning evaluation](README.md#attack-learning-evaluation) section to root README (instant vs batch table, figure links).
- Extended [reports/attack-learning-eval/summary.md](reports/attack-learning-eval/summary.md) with per-figure interpretation; prefer `metrics.json` when numbers must align with CI.
- **Fig 4 omitted** from README, [docs/AI_LEARNING.md](docs/AI_LEARNING.md), and [reports/attack-learning-eval/summary.md](reports/attack-learning-eval/summary.md) — `fig4-cdf-time-to-suggestion.png` is a degenerate CDF (one point per category); use median time-to-suggestion in the metrics table instead.

## [2.8.1] - 2026-05-18

### Added
- **Per-block instant attack learning** — `recordBlockLearningEvent` updates rolling stats and `~/.mcp-guardian/.attack-learning-state.json` synchronously on every policy block; queues attack-pattern suggestions after N same (rule, tool) blocks within a sliding window (default 3 in 5 min).
- **Optional instant LLM classifier** — `GUARDIAN_AI_INSTANT_LLM=true` runs a rate-limited small classifier on critical blocks (`semantic-shell-guard`, `secret-scan`, `path-guard`).
- **Metrics** — `mcp_guardian_instant_learning_events_total`; structured log `instant_learning_event`.

### Changed
- **Proxy block path** — `recordDeniedCall` → `recordBlockLearningEvent` (instant stats + debounced full cycle).
- **Attack pattern learner** — incremental `suggestFromBlockedGroup` for instant and batch paths.

### Environment
| Variable | Default | Purpose |
|----------|---------|---------|
| `GUARDIAN_AI_INSTANT_LEARNING` | on (with AI) | Sync per-block stats + suggestion queue |
| `GUARDIAN_AI_INSTANT_WINDOW_MS` | `300000` | Sliding window for repeat-block detection |
| `GUARDIAN_AI_INSTANT_LLM` | `false` | LLM classifier on critical blocks |
| `GUARDIAN_AI_INSTANT_LLM_RATE_MS` | `60000` | Global LLM rate limit per block path |
| `GUARDIAN_AI_ATTACK_STATE_PATH` | `~/.mcp-guardian/.attack-learning-state.json` | Instant learning state file |
| `GUARDIAN_AI_BLOCK_DEBOUNCE_MS` | `30000` | Set `0` for immediate full learning cycle after each block |

## [2.8.0] - 2026-05-18

### Production hardening bundle

Resolves and documents all production blockers in [docs/PRODUCTION_BLOCKERS.md](docs/PRODUCTION_BLOCKERS.md).

### Fixed
- **LRU memory leaks** — `updateAgeOnGet: false` on `llm-cache`, CVE cache, dashboard login limiter, and session/nonce caches (LRU max 10k / 50k with periodic sweep).
- **Session cache** — Replaced unbounded `Map` with bounded LRU for long IDE sessions.

### Added
- **Policy engine memory test** — `tests/policy/policy-engine-memory.test.ts` (120k unique clients, cache stays at max).
- **PgBouncer strict-mode test** — Fail startup when `GUARDIAN_STRICT_MODE` + `REPLICA_COUNT` > 50 and direct `:5432`.
- **DPoP concurrent claims** — 100-way race + 50 distinct jtis in `tests/auth/dpop-redis-lock.test.ts`.
- **Cost audit default** — Explicit test that `allowsCostEstimates()` is false without `GUARDIAN_COST_ALLOW_ESTIMATES`.
- **`@mcp-guardian/plugin-sdk`** — `publishConfig`, `prepublishOnly` build; monorepo `workspace:*` documented in [docs/PLUGIN_SDK.md](docs/PLUGIN_SDK.md).

## [2.7.11] - 2026-05-18

### Changed
- **Cost auditor — actual vs estimated** — Audit/report without proxy `call_records` no longer fabricates per-tool token volumes from `tools/list`. Reports **`model-only`**: resolved model, official list rates (`$`/M input/output), **$0 measured** until traffic goes through `mcp-guardian proxy`. Measured usage uses **`costSource: actual`** from proxy records.
- **`costSource` values** — `actual` (proxy records), `model-only` (rates only), `estimated` (legacy simulation, opt-in), `none`.
- **Model discovery** — `resolveModelIdForServer()` reads server `env`, `--model` in `args`, `GUARDIAN_MODEL_<SERVER>`, `CURSOR_MODEL` / `CLINE_MODEL`, and Cline `globalState.json` act-mode model; documented chain in `src/config/llm-config.ts`.
- **Proxy call records** — Persist `model` on each record via `resolveModelIdForServer` when message metadata has no model.

### Added
- **`GUARDIAN_COST_ALLOW_ESTIMATES=true`** — Opt-in to previous tools/list simulation (`costSource: estimated`).
- **`resolveModelListRates()`** — List-price preview without simulated call volume.

## [2.7.10] - 2026-05-18

### Fixed
- **Cost auditor in audit/scan/report modes** — `mcp-guardian audit` and `report` no longer return empty costs when proxy `call_records` are absent. Connects via `tools/list`, simulates per-tool `tools/call` token footprint with `TokenCounter` + `RuntimeModelPricing`, and persists estimates to `cost_records`.

### Added
- **`resolveModelIdForServer()`** — Per-server model from server `env`, `GUARDIAN_MODEL_<SERVER>`, or global `GUARDIAN_LLM_MODEL` / `GUARDIAN_MODEL`.
- **`src/utils/cost-estimate.ts`** — Schema-based minimal args and per-tool cost breakdown for audit mode.
- **Cost report metadata** — `costSource` (`proxy-records` | `estimated` | `none`), `modelId`, `provider`, `priced` on `CostReport`.

### Tests
- `tests/services/cost-auditor-audit-mode.test.ts`, `resolveModelIdForServer` in `tests/config/llm-config.test.ts`.

## [2.7.9] - 2026-05-18

### Fixed (enterprise security analysis remediation)
- **LRU cache TTL** — `updateAgeOnGet: false` on policy and per-client rate limit caches so hot keys cannot pin entries indefinitely during 8+ hour IDE sessions.
- **DPoP Redis replay** — Short-lived distributed lock around `SET NX` jti claims for multi-replica HA (`claimDpopJtiOnRedis`).
- **Memory monitoring** — Periodic heap/RSS warnings in long-running proxy (`GUARDIAN_MEMORY_MONITOR=false` to disable).
- **PostgreSQL pool** — Configurable `GUARDIAN_PG_POOL_MAX` (default 10); Helm sets `4` per replica when using PgBouncer.
- **Docker reproducibility** — Pin `node:20-alpine` image digest in `Dockerfile`.
- **PowerShell launcher** — `try/catch`, CLI path check, and `ValueFromRemainingArguments` arg forwarding.

### Added
- **Audio token estimates** — `estimateAudioTokens` / `countAudioTokensInPayload` (~25 tokens/sec heuristic) in cost path.
- **Helm PgBouncer guard** — `pgbouncer.requireGuardianEnforcement` sets `GUARDIAN_REQUIRE_PGBOUNCER` for Postgres deployments.
- **CI lockfile gate** — `git ls-files --error-unmatch pnpm-lock.yaml` in CI.

### Tests
- `tests/auth/dpop-redis-lock.test.ts`, `tests/utils/memory-monitor.test.ts`, `tests/cost/multimodal-audio.test.ts`.

## [2.7.8] - 2026-05-18

### Fixed (security review P0/P1)
- **Request timeout** — `tools/call` upstream waits enforce `requestTimeoutMs`; hung upstream returns JSON-RPC `-32006`, records denied call, clears pending slot (`src/proxy/proxy-server.ts`).
- **Redis rate-limit failover** — On Redis errors, log `redis_rate_limit_degraded` and fall back to in-process LRU limiter (never skip rate limits entirely) (`src/policy/policy-engine.ts`).
- **Rug-pull blocking** — Tool fingerprint mismatch blocks subsequent `tools/call` and rejects mutated `tools/list` notifications (OWASP MCP03).
- **Subdomain squatting** — Registrable-domain (eTLD+1) checks block trusted-domain suffix squats like `nvd.nist.gov.attacker.io` (`src/utils/registrable-domain.ts`, `url-guard`, prompt-injection exfiltration).
- **Multi-tool-chaining FP** — Tighter regex avoids flagging numbered search result lists (`src/scanners/prompt-injection-detector.ts`).

### Added
- **OAuth stdio token paths** — `OAuthValidator.extractAuthFromMcpMessage()` reads initialize metadata, JSON-RPC root `Authorization`, `_meta.auth`, and env tokens (`src/auth/oauth.ts`).
- **Corpus CI gates** — Minimum entry count from `corpus/manifest.yaml`, F1 floor (`CORPUS_MIN_F1`, default 85%), minimum attack sample count (`CORPUS_MIN_ATTACK_SAMPLES`, default 50).
- **Per-client rate limit keys** — `tenant:server:tool:clientId` when identity is present (`policy-engine`, proxy per-client limiter).

### Tests
- `tests/proxy/request-timeout.test.ts`, `tests/proxy/rug-pull-block.test.ts`, `tests/policy/redis-rate-limit-fallback.test.ts`, `tests/auth/oauth-stdio-extract.test.ts`, `tests/policy/subdomain-squatting.test.ts`, `tests/scanners/multi-tool-chaining-fp.test.ts`, `tests/utils/registrable-domain.test.ts`.

## [2.7.7] - 2026-05-17

### Fixed
- **Dashboard SPA hydration** — Replaced preview-only static stub with a Next.js App Router client (`deploy/dashboard-spa/`) using client-only mount, error boundary, and graceful handling when the Guardian API on port 4000 is unavailable. Static export served from `out/` (legacy HTML/JS fallback when not built).

### Added
- `pnpm dashboard:build` / `pnpm dashboard:dev` — build or develop the browser dashboard.
- `tests/dashboard/dashboard-spa.test.ts` — structure smoke tests for the dashboard app.

## [2.7.6] - 2026-05-17

### Added
- **Cost governance template** — `policy-templates/enterprise-cost-governance.yaml` + `policy-templates/README.md` (rate limits, token budgets, `GUARDIAN_DAILY_BUDGET_USD`).
- **DPoP enforcement** — `GUARDIAN_REQUIRE_DPOP=true` rejects requests without valid proof (`src/auth/dpop-enforcement.ts`); Helm `dpop.require`.
- **Redis HA** — Sentinel (`REDIS_SENTINELS`, `REDIS_SENTINEL_MASTER_NAME`) and Cluster (`REDIS_CLUSTER_NODES`) via `src/utils/redis-client.ts`; [docs/REDIS_HA.md](docs/REDIS_HA.md).
- **Production auth guide** — [docs/PRODUCTION_AUTH.md](docs/PRODUCTION_AUTH.md) (DPoP + mTLS).
- **Helm mTLS** — `templates/mtls-secret.yaml`, volume mounts, `mtls.enabled` values.
- **Docker supply chain** — non-root `USER 1001`, `scripts/verify-docker-prebuilds.sh`, docker-publish smoke test as uid 1001.

### Changed
- `CostAuditor` — `getDailySpendUsd()`, `isDailyBudgetExceeded()`, `GUARDIAN_DAILY_BUDGET_USD` env.
- DPoP nonce store, rate limiter, LLM cache, session cache use shared Redis client factory.

### Tests
- `tests/policy/cost-governance.test.ts`, `tests/auth/dpop-require.test.ts`, `tests/utils/redis-client.test.ts`, `tests/utils/mtls-config.test.ts`.

## [2.7.5] - 2026-05-17

### Added
- **Enterprise LLM/MCP corpus** — 226 real attack fixtures under `corpus/` (benign, prompt-injection, credential-exfil, sql-nosql, ssrf-url, shell-obfuscation, cross-tool-chain, edge-cases); `corpus/manifest.yaml`, `corpus/README.md`.
- **Corpus eval** — `corpus/run-eval.ts` runs each entry through `PolicyEngine` + `default-policy.yaml`; per-category precision/recall; writes `corpus-eval-report.json`; fails CI on missed attacks.
- **Benchmarks in CI** — `benchmarks` job in `.github/workflows/ci.yml`; p95 gate via `BENCH_P95_THRESHOLD_MS`; `benchmarks/README.md`.
- **E2E adversarial proxy** — `tests/e2e/adversarial-proxy.e2e.test.ts` (10 corpus attacks through live proxy).
- **Pen-test artifacts** — `docs/PEN_TEST_REPORT.md`, `security/ATTACK_MATRIX.md`, `scripts/generate-pen-test-report.cjs`.

### Changed
- Corpus eval workflow (PR + nightly) uploads `corpus-eval-report.json`.
- `pnpm eval` uses PolicyEngine (replaces legacy `scanTool` poisoned/benign layout).

## [2.7.4] - 2026-05-17

### Added
- **Redis LLM cache (ARCH-4)** — `src/ai/llm-cache.ts` with Redis-backed responses and in-memory LRU fallback; keys hash `model + system + prompt + temperature`; metrics `mcp_guardian_llm_cache_hits_total` / `mcp_guardian_llm_cache_misses_total`.
- **Centralized LLM config (CQ-3)** — `src/config/llm-config.ts` (`getLlmConfig`, `resolveModelId`) replaces scattered hardcoded models/token limits in semantic scan, `LlmAssistant`, proxy cost path, and suggestion engine.

### Changed
- Semantic scanner (`packages/core`) and async semantic audit / Ollama assistant use shared cache + config.
- Env: `GUARDIAN_LLM_CACHE`, `GUARDIAN_LLM_CACHE_TTL_SEC`, `GUARDIAN_LLM_PROVIDER`, `GUARDIAN_LLM_MODEL`, `GUARDIAN_LLM_MAX_TOKENS`, `GUARDIAN_LLM_TEMPERATURE`, `OLLAMA_BASE_URL`.

### Tests
- `tests/ai/llm-cache.test.ts`, `tests/config/llm-config.test.ts`.

## [2.7.3] - 2026-05-17

### Fixed (critical code review + complete analysis reports)
- **Config path security** — `sanitizeConfigPath` uses `realpath`, `/root/`/`/srv/`/`/data/` allowlist, Windows drive prefixes; blocks symlink escape (`src/utils/sanitize-config-path.ts`).
- **MCP server DB default** — `~/.mcp-guardian/mcp-server.db` instead of macOS-only `/private/tmp` (still separate from proxy `history.db` for Cline lock isolation).
- **Package version** — MCP server advertises `readPackageVersion()` from `package.json` (no stale `2.3.4` fallback).
- **Scan engine** — Regex + schema layers run in parallel via `Promise.all` (`packages/core/src/engine.ts`).
- **WSL2 paths** — `/mnt/c/...` and `\\wsl$\...` normalization in path guard (`src/utils/wsl-path.ts`).

### Security / compliance
- **DPoP** — Concurrent replay regression test for in-memory nonce store (Redis path already uses `SET NX`).
- **GDPR erase** — Post-erasure row-count assertion; COMPLIANCE.md documents WAL/backup forensic limits.

### CI
- **Supply chain** — `osv-scanner` on `pnpm-lock.yaml` in `.github/workflows/supply-chain.yml`.

### Docs
- [docs/WINDOWS.md](docs/WINDOWS.md) — WSL2 path mapping section.

### Tests
- `tests/utils/sanitize-config-path.test.ts`, `tests/utils/wsl-path.test.ts`, `tests/utils/guardian-db-path.test.ts` (mcp-server.db), `tests/auth/dpop-nonce-store.test.ts`, `tests/database/gdpr-erase.test.ts`, `packages/core/tests/engine.test.ts`.

## [2.7.2] - 2026-05-17

### Added
- **Secret scanner** — Expanded from ~35 to **267** industry-standard detection patterns (Gitleaks/TruffleHog-class coverage): cloud (AWS, GCP, Azure, DigitalOcean, Cloudflare, Heroku), VCS/CI (GitHub, GitLab, Bitbucket, CircleCI, Travis, Jenkins), chat webhooks (Slack, Discord, Telegram, Teams), payments (Stripe, Square, PayPal, Braintree), email/SMS (SendGrid, Mailgun, Twilio, Postmark), AI providers (OpenAI, Anthropic, HuggingFace, Cohere, Replicate, Groq), databases (postgres, mysql, mongodb, redis, amqp, jdbc), crypto keys, OAuth/JWT/session tokens, package registries (npm, PyPI, RubyGems, NuGet), and generic high-entropy assignments.
- `getSecretRuleCount()` export for transparency; rules live in `src/scanners/secret-rules.ts` with pre-compiled regex at module load.

### Tests
- `tests/secret-scanner-coverage.test.ts` — asserts ≥150 rules and spot-checks 20 provider categories.

## [2.7.1] - 2026-05-17

### Fixed (developer deep-dive review)
- **Secret scanner** — Confirmed 35+ regex rules in source (reviewer tarball was stale); added tests for `postgresql://` URLs and `DATABASE_URL` env values.
- **Storage docs** — Clarified **better-sqlite3** (WAL + `busy_timeout=5000`), not `sql.js`; [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **SSE coverage** — Structured `sse_untracked` warning, `untrackedSse` on security scan reports, Prometheus `mcp_guardian_sse_untracked_servers`.
- **SSE response inspection** — `evaluateResponse` + prompt-injection blocking on `SseProxyServer` (parity with stdio proxy).
- **README** — Token counts documented as approximate unless API `usage` is returned.

### Tests
- `tests/secret-scanner.test.ts` (postgres URL, rule-count probe), `tests/policy/adversarial-scenarios.test.ts` (malicious response), `tests/services/security-scanner.test.ts` (`untrackedSse`).

## [2.7.0] - 2026-05-17

### Added (enterprise readiness)
- **Detector Plugin SDK v3.0** — `@mcp-guardian/plugin-sdk` with `createDetectorPlugin`, lifecycle hooks (`onLoad`/`onUnload`); plugins on by default (`GUARDIAN_PLUGINS_ENABLED=false` to disable). See [docs/PLUGIN_SDK.md](docs/PLUGIN_SDK.md).
- **HTTP tools policy template** — `policy-templates/http-tools-policy.yaml`; merge with `GUARDIAN_HTTP_TOOLS_POLICY=true`.
- **Browser dashboard SPA** — `deploy/dashboard-spa/` (REST + WebSocket); served at `/` when present (`GUARDIAN_DASHBOARD_SPA=false` for legacy page).
- **Fleet CLI** — `mcp-guardian fleet status` (Postgres `guardian_instances` or `GUARDIAN_FLEET_DB_PATHS`); TUI **Fleet** tab (key 9).
- **Multi-region** — `GUARDIAN_REGION` labels; Redis rate-limit keys per region; optional `GUARDIAN_RATE_LIMIT_DISTRIBUTED_LOCK`. [docs/MULTI_REGION.md](docs/MULTI_REGION.md) (active-passive, not active-active).
- **Async semantic audit** — queue cap, min confidence, Prometheus metrics (`mcp_guardian_semantic_audit_*`). [docs/AI_LEARNING.md](docs/AI_LEARNING.md).
- **Windows installer** — Inno Setup script `installer/windows/mcp-guardian.iss` + build docs.

### Tests
- `tests/policy/policy-merge.test.ts`, `tests/plugins/plugin-sdk.test.ts`, `tests/fleet/fleet-status.test.ts`, `tests/utils/region.test.ts`.

## [2.6.8] - 2026-05-17

### Security (58-scenario adversarial report)
- **URL guard** (`src/policy/url-guard.ts`) — blocks metadata IPs, `file://` / `javascript:` / `data:`, private IPs, decimal IP localhost, `[::1]`, and webhook/callback SSRF; wired into semantic guards for puppeteer and all `url`/`href`/`target`/`webhook`/`callback` fields.
- **Sensitive paths** — docker.sock, Kubernetes service-account secrets, `terraform.tfstate`, `.npmrc`, `.git-credentials`, `.vault-token`, service-account JSON patterns.
- **`evaluateResponse`** — null/undefined-safe (no crash on `matchAll`).
- **SQL / NoSQL / GraphQL / LDAP** — expanded semantic and YAML patterns (`UNION…SELECT`, `LOAD_FILE`, `SLEEP`, `benchmark`, `$where`, `__schema`, LDAP filters).
- **SSTI & prompt injection** — `{{`, `${`, `<%`, `#{` in arguments; zero-width strip before injection detect; multi-line injection patterns.
- **`default-policy.yaml`** — `block-dangerous-urls` rule; expanded path/SQL/shell patterns.

### Tests
- `tests/policy/adversarial-scenarios.test.ts`, `tests/policy/url-guard.test.ts`.

## [2.6.7] - 2026-05-17

### Fixed (MASTER test report)
- **Cost pricing recursion** — `resolveModelId` no longer calls `getActivePricing()` (breaks `detectActivePricing` ↔ `resolveModelId` stack overflow when only env/Cline model id is set).
- **Proxy response observability** — `response_sent` structured event when upstream JSON-RPC is written to the IDE client.

### Added
- **GDPR Article 17** — `HistoryDatabase.eraseAllAuditData()` wipes all audit tables; documented in [docs/COMPLIANCE.md](docs/COMPLIANCE.md) with retention defaults.

### Tests
- `tests/services/runtime-model-pricing.test.ts`, `tests/database/gdpr-erase.test.ts`.

## [2.6.6] - 2026-05-17

### Fixed (comprehensive real test report)
- **Integration stability** — `proxy-audit` uses `benchmarks/fixtures/integration-mcp-server.cjs` (fixes inline `-e` mock crash / zero-token flakes); `real-mcp-server` keeps trailing newlines and longer waits for slow CI VMs.
- **DPoP multi-replica** — `REDIS_URL` enables Redis `SET NX` jti deduplication (`src/auth/dpop-nonce-store.ts`); in-memory store unchanged for single instance.

### Security (dev supply chain)
- **Vitest 3** + pnpm overrides `vite>=6.4.2`, `esbuild>=0.25.0` — resolves moderate dev-only audit findings.

### Docs
- **[docs/COMPLIANCE.md](docs/COMPLIANCE.md)** — HIPAA at-rest, GDPR purge, DPoP Redis documented honestly.

## [2.6.5] - 2026-05-16

### Fixed (IDE long-running / concurrency)
- **Metrics lifecycle** — `shutdownMetrics()` / `dispose()` closes the Prometheus HTTP server, clears maintenance intervals, and resets the registry; invoked on proxy shutdown, TUI exit, and dashboard close.
- **SQLite contention** — `persistCallRecord` retries on `SQLITE_BUSY` (3 attempts, exponential backoff); WAL + `busy_timeout=5000` confirmed for all writers sharing `MCP_GUARDIAN_DB_PATH`.
- **Remote SSH paths** — `src/utils/remote-path.ts` maps local IDE paths to remote workspace paths (`GUARDIAN_REMOTE_SSH`, `GUARDIAN_REMOTE_PATH_MAP`); wired into path-guard and `wrap`.

### Docs
- **[docs/REMOTE_SSH.md](docs/REMOTE_SSH.md)** — VS Code Remote SSH setup.
- **[docs/DEVCONTAINERS.md](docs/DEVCONTAINERS.md)** — Dev container bind mount and shared DB path.

### Tests
- `tests/utils/metrics-dispose.test.ts`, `tests/utils/remote-path.test.ts`, `tests/database/sqlite-busy-retry.test.ts`.

## [2.6.4] - 2026-05-16

### Fixed (extensibility / Test 8)
- **OPA precedence** — OPA/Rego block always wins over YAML pass; both deny → OPA reason; OPA unavailable falls through to YAML (`resolvePolicyPrecedence`, `evaluateAsync`).
- **Hot reload** — `PolicyWatcher` builds pending engine off the event loop, atomic swap; no evaluate-time lock or "reload in progress" blocks.
- **Detector plugins (experimental v0.1)** — `DetectorPlugin` registry, `GUARDIAN_PLUGINS_ENABLED`, optional `GUARDIAN_PLUGIN_PATH` dynamic load.

### Docs
- **[docs/POLICY.md](docs/POLICY.md)** — Evaluation order: OPA block → YAML → `default_action`.
- **[docs/EXTENSIBILITY.md](docs/EXTENSIBILITY.md)** — Honest status; full SDK v3.0 planned.
- **Example** — `examples/plugins/custom-secret-pattern.js`.

### Tests
- `tests/policy/opa-precedence.test.ts`, `tests/policy/policy-watcher-reload.test.ts`, `tests/plugins/detector-plugin.test.ts`.

## [2.6.3] - 2026-05-16

### Added (Windows)
- **`guardian-proxy.ps1`** — Native PowerShell stdio proxy launcher (repo root + `scripts/`); quotes `node`/`dist/cli.js` paths for usernames and install dirs with spaces.
- **`mcp-guardian wrap` on win32** — Generates `powershell.exe -File guardian-proxy.ps1` entries instead of `guardian-proxy.sh`; Windows client config paths for Cline/Claude Desktop.
- **`src/utils/windows-paths.ts`** — `quotePathForPowerShell`, `resolveGuardianProxyWrapper`, `buildWrappedMcpServerEntry`.
- **`scripts/postinstall-windows.cjs`** — Warns when `better-sqlite3` fails to load on Windows.
- **`installer/README.md`** — MSI installer roadmap (planned v2.7).
- **Tests** — `tests/utils/windows-paths.test.ts`.

### Docs
- **`docs/WINDOWS.md`** — Native PowerShell setup, better-sqlite3 prebuild notes, Cursor example config, MSI roadmap.

## [2.6.2] - 2026-05-16

### Docs (scale & HA)
- **PgBouncer mandatory** — [docs/SCALE_AND_RESILIENCE.md](docs/SCALE_AND_RESILIENCE.md): 100-replica chaos test; required for production >50 replicas or any multi-replica K8s with Postgres; direct `:5432` exhausted `max_connections` at 87 replicas.
- **Cross-region** — Documented: no multi-region active-active yet; >80ms Redis RTT breaks lock semantics.
- **RUNBOOK** — PgBouncer connection strings, backup restore (4m12s / 2.3GB validated), Redis Sentinel AZ failover (RTO 47s, RPO 3s).
- **Helm** — `pgbouncer.enabled: true`, `postgres.maxConnections: 300` comments in values.yaml.

### Added
- **`GUARDIAN_REQUIRE_PGBOUNCER`** — Exit at startup if `DATABASE_URL` is not pooler-shaped; warn on direct `:5432` in K8s/multi-replica Postgres.
- **Tests** — `tests/utils/pgbouncer-check.test.ts`.

## [2.6.1] - 2026-05-16

### Fixed (cost governance accuracy)
- **Provider-aware tokenization** — `detectProvider()` routes OpenAI to tiktoken, Anthropic to optional `@anthropic-ai/tokenizer` or chars÷3.5 heuristic (no OpenAI BPE on Claude).
- **API usage** — Proxy prefers `usage.input_tokens` / `output_tokens` from responses; `tokenSource: api | estimated` on call records; warns when estimate vs API drift >5%.
- **Multimodal** — Image tokens via `(width × height) / 750` added to request counts.
- **Docs** — [docs/COST_GOVERNANCE.md](docs/COST_GOVERNANCE.md) (drift expectations, USD-only currency).
- **Tests** — `tests/utils/token-counter.test.ts`, `tests/cost/multimodal-tokens.test.ts`.

## [2.6.0] - 2026-05-16

### Security (AI learning anti-poisoning)
- **Label quorum** — Weight/threshold changes require ≥2 distinct labelers or ≥10 weighted labels per fingerprint; below quorum logs `learning_quorum_pending` (`GUARDIAN_AI_MIN_DISTINCT_LABELERS`, `GUARDIAN_AI_MIN_TOTAL_LABELS`).
- **Reputation weighting** — `GUARDIAN_AI_LABEL_WEIGHT`, `GUARDIAN_AI_ADMIN_USERS`; burst cap (3 labels/hour/user/fingerprint counts as one).
- **Drift detection** — `drift-detector.ts` compares 7d vs prior 7d token/block-rate stats; freezes auto threshold tuning until `GUARDIAN_AI_DRIFT_OVERRIDE=true`.
- **Rollback** — Snapshots before weight-apply cycles; `mcp-guardian ai rollback`, `POST /api/ai/rollback`; auto-rollback if precision proxy drops >10%.
- **FP whitelist hardening** — Blocks coordinated single-user promotion (5 confirms/1h); dangerous `curl|wget|rm` unblocks require quorum.
- **Tests** — `tests/ai/learning-poisoning.test.ts`, `tests/ai/drift-detector.test.ts`, `tests/ai/fp-whitelist-poisoning.test.ts`.

## [2.5.9] - 2026-05-16

### Security (OWASP ASVS dashboard auth)
- **CSRF** — Double-submit cookie (`mcp_guardian_csrf`) + `X-CSRF-Token` + Origin/Referer validation on POST/PUT/DELETE/PATCH; `GET /api/auth/csrf`; skipped when `DASHBOARD_AUTH_DISABLED=true`.
- **Session fixation** — Login revokes prior `mcp_guardian_session`, always issues fresh token with new `jti`; cookie + Bearer session auth.
- **mTLS** — [docs/MTLS.md](docs/MTLS.md) (honest hot-reload status); `mtls-watcher.ts` skeleton; Helm placeholder comment (pod restart until reload ships).
- **DPoP** — Documented `jti` replay protection; `tests/auth/dpop.test.ts`.

## [2.5.8] - 2026-05-16

### Security (supply chain hardening)
- **`better-sqlite3` ^12.10.0** — Bundled SQLite 3.53.x (≥ 3.50.2) for inherited SQLite CVE mitigation.
- **`jose` ^6.2.3** — Already ≥ 4.15.5 (CVE-2024-28176); documented minimum in SECURITY.md.
- **Typo-squat** — `MALICIOUS_PACKAGE_WATCHLIST` (`pino-sdk-v2`); trusted `@mcp-guardian/cli` and `pino` for lookalike detection.
- **CI** — `supply-chain.yml` audit + CycloneDX SBOM; cosign image signing on GHCR publish; `attest-build-provenance` on npm release artifacts.
- **Docs** — [docs/SUPPLY_CHAIN.md](docs/SUPPLY_CHAIN.md) (lockfile policy, SQLite upgrade path, signing status).

### Changed
- Version **2.5.8**; `pnpm audit --audit-level=high` enforced in CI (moderate dev-only advisories may remain).

## [2.5.7] - 2026-05-16

### Security
- **Unicode TR39 confusables** — Full `confusables.txt` (UTS #39) loaded at startup; `normalizeConfusables()` runs before NFKC in payload normalization and recursive de-obfuscation (~96% detection on homoglyph shell bypass suite vs ~71% with NFKC + Cyrillic fold alone).
- **Policy flag `unicode_strict`** — `policy.unicode_strict` (default `true` in `default-policy.yaml`, `false` in `policy-demo.yaml`). When `false`, skips TR39 confusables pass for international tool arguments.

### Added
- **`assets/confusables.txt`** — Shipped in npm package (`files` includes `assets/`).
- **Tests** — `tests/utils/confusables.test.ts`, `tests/fixtures/confusables-suite.json`, `tests/utils/confusables-suite.test.ts`.

## [2.5.6] - 2026-05-16

### Added
- **Recursive de-obfuscation** — `deobfuscateRecursive()` in payload normalizer (base64, URL, hex, unicode, HTML) before prompt-injection and semantic guards.
- **Async LLM semantic audit** — Post-hoc `tools/call` queue (`GUARDIAN_SEMANTIC_ASYNC`, default on when LLM enabled); sync path stays regex/semantic only; flags via `async_semantic_flag` structured log.
- **FP auto-whitelist** — Three dashboard/TUI false-positive confirmations persist to `~/.mcp-guardian/.fp-whitelist.json` (`GUARDIAN_FP_WHITELIST_THRESHOLD`).
- **Policy playground CLI** — `mcp-guardian policy test --policy … --tool … --args '{…}'` prints decision JSON.
- **Windows notes** — `docs/WINDOWS.md` (paths, limitations, named-pipes TODO).

### Env
- `GUARDIAN_SEMANTIC_ASYNC`, `GUARDIAN_SEMANTIC_DEBOUNCE_MS`, `GUARDIAN_FP_WHITELIST_THRESHOLD`, `GUARDIAN_FP_WHITELIST_PATH`

## [2.5.5] - 2026-05-16

### Added
- **Attack-driven learning** — Debounced learning cycle on proxy blocks (`onPolicyBlock`); `attack-pattern-learner` heuristics from blocked `call_records`; manual accept applies rules via `policy-applier` + PolicyWatcher hot-reload.
- **Policy decision ingestion** — Proxy records pass/block/flag decisions into `DataCollector`; learning metadata uses blocked rows from SQLite.
- **Live attack matrix** — Post-proxy learning assertion in `scripts/run-live-attack-matrix.cjs`.
- **Tests** — `tests/ai/attack-driven-learning.test.ts`.

### Env
- `GUARDIAN_AI_BLOCK_DEBOUNCE_MS` (default `30000`), `GUARDIAN_AI_ATTACK_MIN_BLOCKS` (default `3`).

## [2.5.4] - 2026-05-16

### Security (FINCO / semantic abuse)
- **Semantic guards at proxy** — Sensitive paths (`.ssh`, `.env`, `/`, `/etc`), SQL bulk-exfil patterns, GitHub write tools denied, prompt-injection in args, PowerShell `-enc`.
- **Path workspace scoping** — `GUARDIAN_WORKSPACE` / `GUARDIAN_ALLOWED_PATH_PREFIXES` restrict filesystem tools to project dirs.
- **GitHub repo allowlist** — `GUARDIAN_GITHUB_ALLOWED_ORGS` / `GUARDIAN_GITHUB_ALLOWED_REPOS`.
- **Homoglyph folding** — Cyrillic/Greek lookalikes normalized before regex (e.g. `/etс/passwd`).
- **Proxy entropy DLP** — High-entropy / base64 blobs blocked in `block` mode (`GUARDIAN_PROXY_ENTROPY=false` to disable).
- **default-policy.yaml** — Deny GitHub mutations; sensitive path argPatterns; SQL exfil rules; read-only allowlist (no `write_to_file`).
- **Tests** — `tests/policy/finco-attack-chain.test.ts` reproduces the full FINCO chain.

## [2.5.3] - 2026-05-16

### Security (production hardening)
- **CVE gate opt-in** — `GUARDIAN_BLOCK_ON_CVE` defaults to off; when enabled, blocks CRITICAL CVEs only (set `GUARDIAN_CVE_BLOCK_SEVERITY=HIGH` to widen).
- **Dashboard fail-closed** — Auth required by default when dashboard is on; requests rejected if `DASHBOARD_API_KEY` / `DASHBOARD_JWT_SECRET` missing (`DASHBOARD_AUTH_DISABLED=true` for local dev only).
- **Proxy stdout** — Pino/structured logs go to stderr so MCP JSON-RPC on stdout is not corrupted.
- **OSV severity parser** — Handles string, array, and object severity shapes (fixes silent scan failures).
- **CLI version** — Reads from `package.json` (no hardcoded drift).
- **`--blocking-mode`** — Applies unless `GUARDIAN_DISALLOW_MODE_OVERRIDE=true`.
- **AI on CLI** — Learning on `scan`/`audit`/`health`/`report` only when `GUARDIAN_AI_ON_CLI=true`.
- **Typo-squat** — Tail-segment matching (e.g. `server-githhub`).
- **Secret scanner** — Dedupes overlapping rule hits per scan.
- **npm tarball** — Ships `deploy/dashboard.html`; dashboard loader searches multiple paths.

### Dependencies
- **pnpm override** — `protobufjs>=8.0.2` to reduce transitive HIGH advisories from OpenTelemetry.

## [2.5.2] - 2026-05-16

### Added
- **TUI-first observability** — Read-only SQLite access while proxy writes; per-server Instances tab; live FULL ANALYSIS from `call_records` (not stale `.ai-report.json`).
- **`mcp-guardian doctor`** — Checks DB path, policy, and AI flags.
- **`pnpm run live:tui-demo`** — Multi-server corpus replay into shared `history.db` for local TUI smoke tests.
- **Dogfood CI** — Sandboxed scenario in GitHub Actions; `scenarios/dogfood/` harness and enterprise stub.
- **Shared DB utilities** — `guardian-db-path`, `db-aggregate`, CVE gate, preflight scan, runtime model pricing, WebSocket dashboard events.

### Fixed
- **SQLite concurrency** — TUI opens canonical DB read-only; secondary writers share WAL + `busy_timeout` instead of forked `history-<pid>.db` files.
- **Dashboard EADDRINUSE** — Proxy continues if port 4000 is busy (warns; WS optional).
- **AI learning** — Persists cycle state and baselines; preventive suggestions when traffic is stable; learning on by default (`GUARDIAN_AI_ENABLED=false` to disable).
- **TUI poll** — 1.5s refresh with read-only reconnect; dashboard metrics no longer zero live DB counts.

### Docs
- README: honest TUI limitations, live-update troubleshooting, `live:tui-demo` vs dogfood vs production wrap.

## [2.5.1] - 2026-05-16

### Fixed (dogfood / observability)
- **Denied call records** — Policy and DLP blocks are persisted to `history.db` with `blocked`, `block_rule`, and `block_reason` for audit/TUI/dashboard accuracy.
- **Policy rule order** — `deny-dangerous-tools` runs before allowlist; path-traversal (`..`) runs before shell-injection; `/etc/passwd` removed from shell patterns so traversal attribution is correct.
- **`flag` in block mode** — Rate-limit and token-budget `flag` rules now deny requests when policy mode is `block`.
- **DLP error shape** — Secret blocks return consistent `Blocked by MCP Guardian policy` message with `data.rule: secret-scan`.
- **Dogfood harness** — Full CLI corpus replay per server, expected-rule assertions, DB blocked-count gate, Phase 4 summary output.

### Fixed (P0 — security audit)
- **AWS DLP** — Secret scanner entropy check now runs on the full matched secret, not a 4-char prefix capture group; AWS access keys (e.g. `AKIAIOSFODNN7EXAMPLE`) are detected again.
- **Fail-closed default policy** — `default-policy.yaml` uses `default_action: block` with an explicit tool allowlist.
- **Multi-stdio guard** — Proxy CLI exits with an error when multiple stdio servers are configured in one process (prevents stdin broadcast).
- **`--blocking-mode`** — Mode override applies in memory only; no longer rewrites the policy YAML on disk.

### Security
- Bump `@modelcontextprotocol/sdk` to ^1.25.2 (resolves ReDoS and related advisories in the pinned 1.0.x line).

## [2.3.24] - 2026-05-14

### Fixed
- **DB lock isolation** — `HistoryDatabase` constructor (line 73) now reads `MCP_GUARDIAN_DB_PATH` env var as fallback, enabling multiple concurrent proxy instances with separate databases
- **container.ts** — `createContainer()` respects `MCP_GUARDIAN_DB_PATH` for all CLI commands (scan, audit, health, report, proxy), preventing lock conflicts when proxies are running
- **index.ts** — MCP server startup hardcodes a separate DB path (`/private/tmp/mcp-guardian-server.db`) to avoid lock conflicts with proxy instances; Cline does not support `env` field in MCP config
- **macOS `/tmp` symlink** — Launch scripts now use `/private/tmp` instead of `/tmp` to avoid `proper-lockfile` ENOENT stat errors on macOS
- **`mcp-guardian proxy`** — `HistoryDatabase(dbPath)` at lines 283 and 391 now passes `process.env.MCP_GUARDIAN_DB_PATH || undefined`

### Added
- **`scripts/full-cost-report.cjs`** — Auto-detects Cline model from `~/.cline/data/globalState.json`, reads proxy databases for precise MCP tool call costs, estimates LLM conversation costs
- **`scripts/launch-proxies.sh`** — Clean startup script for multiple proxy instances with separate DB paths, health-check polling, and port cleanup
- **`scripts/cost-audit.cjs`** — CLI cost audit with per-model pricing support
- **`scripts/query-tokens.cjs`** — Quick token query from proxy databases
- **`scripts/mcp-guardian-server.sh`** — Wrapper script for mcp-guardian MCP server with env var export

## [2.1.2] - 2026-05-11

### Fixed
- oauth.ts TypeScript type error (`ReturnType` → `jose.createRemoteJWKSet`)
- Memory leaks in policy engine and proxy rate counters (LRUCache with TTL)
- README version reference (v2.0.0 → v2.1.2)
- `mcp-guardian://latest-scan` now reads real data from database
- scan-mcp.yml CI workflow references published package

### Added
- `glama.json` metadata for Glama registry
- Zod validation schemas (`src/validation/schemas.ts`)
- YAML config parsing support (`.yaml`/`.yml` files)
- Dashboard login rate limiting (5 attempts/min/IP via LRUCache)
- Dockerfile hardened: multi-stage build, non-root user, health check
- Docker build + Trivy security scan in CI
- Dynamic version from `npm_package_version`

## [2.1.0] - 2026-05-10

### Added
- Three-layer detection engine: regex triage → schema analysis → LLM semantic verdict
- Monorepo architecture (pnpm workspace, 3 packages)
- Tamper-resistant manifest (HMAC-SHA256)
- Red-team corpus with precision/recall CI gate
- HTTP/SSE transparent proxy for cost auditing
- Transitive dependency CVE scanning (npm ls --json)
- 40+ secret patterns (AWS, Azure, GCP, Stripe, Slack, Twilio, etc.)
- Per-provider token counting with `isEstimate` flag
- CVE triage (direct vs transitive classification)
- Child-process watchdog (30s timeout, auto-restart)
- Data retention (hourly purge, 30-day TTL)
- Dashboard CSP + HSTS via helmet middleware
- Scoring formula: positive bonuses, clamped 0-100
- Coverage enforcement in CI (40% threshold)
- Helm chart CI/CD workflow

### Changed
- Token counter: provider-specific counting strategies
- Secret scanner: expanded from 6 to 40+ patterns
- Scoring model: add positive bonuses and floor clamping
- Policy engine: LRUCache-backed rate counters

## [2.0.0] - 2026-05-10

### Added
- Monorepo structure: `@mcp-guardian/core`, `@mcp-guardian/cli`, `@mcp-guardian/server`
- Three-layer detection engine (regex + schema + LLM semantic)
- Tamper-resistant manifest with HMAC-SHA256
- Red-team corpus (4 poisoned + 1 benign + run-eval.ts)
- Transport layer (stdio + HTTP/SSE tool fetching)
- Corpus evaluation with nightly CI
- Provenance-signed npm publishing
- CLI package with --fail-on-critical, --json, --verbose
- Server package with scan_mcp_tools + verify_manifest

### Breaking
- Moved to pnpm workspace monorepo from single package
- Root package renamed to avoid namespace collision with server package
- CLI entry point restructured for monorepo

## [1.3.0] - 2026-05-09

### Added
- E2E proxy tests with real default-policy.yaml
- Supply chain CI pipeline (npm audit, CycloneDX SBOM, provenance)
- mTLS zero-trust networking for proxy ↔ upstream
- Operational runbooks (7 scenarios with SLOs)
- Disaster recovery plan (RTO/RPO, backup strategy, recovery drills)

### Fixed
- GitHub language detection corrected to TypeScript
- npm keywords expanded to 22 terms

## [1.2.0] - 2026-05-09

### Added
- Payload normalization layer (URL/hex/unicode/HTML entity decode)
- Semantic shell AST analysis (command substitution, pipe chains, redirects)
- Dashboard authentication (JWT sessions, API keys, CSRF protection)
- Dashboard login rate limiting

### Changed
- Policy engine: normalized payloads before regex evaluation
- Policy engine: semantic analysis integrated into evaluate() pipeline

## [1.0.0] - 2026-05-08

### Added
- Web dashboard with live Prometheus metrics and policy editor
- Redis session cache for cross-replica HA
- Redis shared rate limit counters
- DPoP (RFC 9449) sender-constrained token support
- OpenTelemetry distributed tracing (OTLP)
- HTTP/SSE proxy server for remote MCP transport
- Proxy interceptor with circuit breaker
- Benchmark suite with real proxy overhead measurements
- Helm chart for Kubernetes deployment
- 97 tests across 13 suites

### Changed
- Production-grade scoring with performance benchmarks
- Published to npm as `@mcp-guardian/server@1.0.0`

## [0.7.0] - 2026-05-08

### Added
- Redis session cache for multi-replica HA deployments
- Prometheus metrics endpoint (counters, gauges, histograms)
- E2E integration tests (real MCP server through proxy)
- Prometheus + Grafana dashboard configuration

## [0.6.0] - 2026-05-08

### Added
- Session-based replay protection (5-min session tokens)
- Nonce tracking for JWT replay detection
- Hot-reload policies (chokidar file watcher)
- PolicyAuditor for compliance audit trail
- Formal threat model documentation (THREAT_MODEL.md)

## [0.5.0] - 2026-05-08

### Added
- OAuth 2.1/OIDC JWT authentication for proxy
- OIDC Discovery (RFC 8414) with JWKS caching
- Bearer token extraction and validation
- Agent identity mapping from JWT claims

## [0.4.0] - 2026-05-08

### Added
- Active policy engine (YAML-configurable)
- Structured JSON logging (pino) for SIEM ingestion
- STRIDE threat model documentation
- Command injection validation (10 patterns)
- 74 tests across multiple suites

## [0.3.0] - 2026-05-08

### Added
- Dependency Injection container (IoC pattern)
- Token-bucket rate limiter
- TLS certificate validation
- Full JSON-RPC 2.0 state machine
- SSE/HTTP transport probing
- GitHub Actions CI (Node 18/20/22 matrix)
- 52 unit tests across 6 modules

### Changed
- Package name: `@mcp-doctor/server` → `@mcp-guardian/server`
- SQLite backend: `better-sqlite3` → `sql.js` (pure JS)
- 6 alert threshold CLI flags with exit codes

## [0.1.0] - 2026-05-07

### Added
- Initial release
- Core security scanning (CVE, auth, typo-squat, secrets)
- Cost auditing with multi-model pricing
- Health monitoring
- MCP server entry point (stdio, 4 tools)
- CLI wrapper (scan, audit, health, report)
- Config parser for Cline, Claude Desktop, Cursor, Windsurf