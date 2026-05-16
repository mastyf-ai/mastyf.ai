# Changelog

All notable changes to MCP Guardian will be documented in this file.

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