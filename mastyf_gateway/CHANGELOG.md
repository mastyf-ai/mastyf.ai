# Changelog

All notable changes to **Mastyf Security Gateway** are documented in this file.

## [0.1.0] - 2026-09-05

### Added
- **Unified CLI (`mastyf`)**: Added `mastyf init`, `mastyf doctor`, `mastyf model install v6`, `mastyf start`, `mastyf test --security`, and `mastyf test --load`.
- **Deterministic CBAC Engine**: Deterministic capability checking (2.8–2.9 μs P50) with argument types, bounds, regex, and domain validation.
- **Deterministic DIFC Engine**: Session-bound Information Flow Control tracking untrusted taint across tools and exfiltration sinks.
- **Decision Arbiter**: Enforces strict Authority Monotonicity ($\text{Authority}(\text{Final}) \subseteq \text{Authority}(\text{CBAC}) \cap \text{Authority}(\text{DIFC})$).
- **Model Context Protocol (MCP) Proxy**: Intercepts `tools/call` with proven zero-backend-execution guarantee on blocked/escalated calls.
- **Model Cryptographic Pinning**: Pinned to frozen $V_6$ revision `d59a6aa01f9139dff106146addb04109afa69c03`.
- **40 Automated Invariant & Security Tests**: 100% pass rate across arbiter dominance, authority monotonicity, fail-closed behavior, state isolation, fuzzing, and concurrency.
