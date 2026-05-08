# Changelog

All notable changes to MCP Doctor will be documented in this file.

## [0.3.0] - 2026-05-08

### Added
- **Phase 4: Advanced Production Features**
  - Dependency Injection container (`src/container.ts`) — IoC pattern with `createContainer()`
  - Token-bucket rate limiter (`src/utils/rate-limiter.ts`) — integrated into OSV and NVD clients
  - TLS certificate validation (`src/utils/tls-checker.ts`) — validity, expiry, issuer inspection

- **Phase 3: Real Data Integration**
  - Full JSON-RPC 2.0 state machine in MCP client (initialize → initialized → tools/list)
  - SSE/HTTP transport probing with auth header support
  - Health monitor updated to use live probe results

- **Phase 2: Testing Infrastructure**
  - Vitest configuration with v8 coverage
  - 52 unit tests across 6 modules (config-parser, secret-scanner, auth-prober, typo-squat-detector, scoring, pricing-client)

- **Phase 1: Production Hardening**
  - Logger bug fix (DEBUG level now correctly detected)
  - Graceful shutdown (SIGINT/SIGTERM handlers)
  - Batched database saves (1s debounced flush)
  - Deduplicated scoring function (`src/utils/scoring.ts`)
  - GitHub Actions CI workflow (Node 18/20/22 matrix)
  - Structured MCP output (JSON format returns resource + text)

### Changed
- Package name: `@mcp-doctor/server` → `@rudraneel/mcp-doctor`
- Version: `0.1.0` → `0.3.0`
- SQLite backend: `better-sqlite3` → `sql.js` (pure JS, no native compilation)
- Config parser: now supports `--all` flag for multi-config aggregation with deduplication
- CLI: added 6 alert threshold flags with exit codes 1/2

### Security
- Rate limiting prevents API ban on OSV.dev and NVD calls
- TLS certificate validation added to security scan

## [0.1.0] - 2026-05-07

### Added
- Initial release
- Core security scanning (CVE check, auth probe, typo-squat detection, secret scanning)
- Cost auditing with multi-model pricing (6 models initially)
- Health monitoring with latency and success rate tracking
- MCP server entry point (stdio transport, 4 tools)
- CLI wrapper (scan, audit, health, report)
- Config parser for Cline, Claude Desktop, Cursor, Windsurf
- SQLite history storage