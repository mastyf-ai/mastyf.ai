# Changelog

All notable changes to **Mastyf Security Gateway** are documented in this file.

## [0.1.1] - 2026-09-06

### Added
- **Phase 1: Declarative Policy Engine (`mastyf-policy.yaml`)**:
  - Safe YAML schema parsing with strict validation of types, bounds, regexes, and duplicate detection.
  - Deterministic compilation into native CBAC capability lists, DIFC flow lattices, and canonical rule hashes.
  - CLI commands: `mastyf policy init` (generate starter policy) and `mastyf policy validate <path>` (compile & verify schema).
- **Phase 2: MCP Stdio Reverse Proxy with Zero-Byte Enforcement**:
  - Transparent `mastyf proxy` command mediating Model Context Protocol (MCP) `tools/call` requests over standard I/O.
  - Dedicated single child-stdout reader thread with asynchronous pending-request correlation, eliminating race conditions under concurrent client calls.
  - Physical zero-byte delivery invariant: Non-ALLOW decisions (`BLOCK`, `ESCALATE`) write strictly zero bytes to child process `stdin`.
- **Phase 3: Cryptographic Execution Receipts with Transport Certainty Model**:
  - Append-only, tamper-evident SHA-256 hash-chained execution ledger (`audit.jsonl`).
  - Canonical JSON serialization with RFC 8785 semantics (sorted keys, compact separators, UTF-8, float normalization).
  - Explicit execution-observation contract separating observation from inference:
    - `RESPONSE_RECEIVED`: Confirmed child process execution (`backend_execution_count: 1`).
    - `SENT_CHILD_NO_RESPONSE`: Post-dispatch timeout or child crash; recorded as `null` / `UNKNOWN` certainty rather than falsely inferring zero execution.
    - `NOT_SENT`: Non-ALLOW decisions; recorded as `backend_execution_count: 0`.
  - CLI verification command: `mastyf audit verify` with cryptographic chain validation.
- **Phase 4: Stateful Workflow Authorization & Sequence Policy Graph**:
  - Session-scoped finite state machine tracking declared multi-step application states (e.g. `CLEAN` $\to$ `PII_OBSERVED`).
  - Outcome-conditioned state commits: transitions commit on `RESPONSE_RECEIVED`, discard on `NOT_SENT`, and retain prior state with `UNKNOWN` certainty on `SENT_CHILD_NO_RESPONSE`.
  - Monotonic authority intersection: $A_{\mathrm{det}} = A_{\mathrm{CBAC}} \cap A_{\mathrm{DIFC}} \cap A_{\mathrm{Workflow}}$ — workflow constraints can only reduce authority, never expand it.
  - Declarative sequence rules: `transitions`, `constraints` (state- and certainty-conditioned), `cannot_follow`, `requires_state`, and `max_occurrences`.
- **System-Level Adversarial Workflow Validation Suite**:
  - 23 black-box adversarial tests (`tests/security/test_adversarial_workflow_trajectories.py`) exercising the full gateway execution boundary.
  - Integration harness (`AdversarialGatewayHarness`) validating canonical exfiltration trajectories, alternate sinks, session isolation, 25-way concurrency barriers, malformed-input desynchronization, post-dispatch uncertainty, authority intersection, and receipt tampering.
  - **Status Statement**:
    > **System-level adversarial validation completed: 23/23 tests passed, with 118/118 gateway tests passing when combined with the existing Phase 1–4 regression suite. The validation exercised trajectory constraints, sink-evasion attempts, concurrent session isolation, malformed-input desynchronization, post-dispatch execution uncertainty, authority intersection, and cryptographic receipt integrity.**
  - *Claim Scope*: The adversarial validation confirms that implemented workflow constraints survived the specified adversarial trajectories and integration attacks; it is not a claim of general resistance to arbitrary multi-step attacks.

---

## [0.1.0] - 2026-09-05

### Added
- **Unified CLI (`mastyf`)**: Added `mastyf init`, `mastyf doctor`, `mastyf model install v6`, `mastyf start`, `mastyf test --security`, and `mastyf test --load`.
- **Deterministic CBAC Engine**: Deterministic capability checking (2.8–2.9 μs P50) with argument types, bounds, regex, and domain validation.
- **Deterministic DIFC Engine**: Session-bound Information Flow Control tracking untrusted taint across tools and exfiltration sinks.
- **Decision Arbiter**: Enforces strict Authority Monotonicity ($\text{Authority}(\text{Final}) \subseteq \text{Authority}(\text{CBAC}) \cap \text{Authority}(\text{DIFC})$).
- **Model Context Protocol (MCP) Proxy**: Intercepts `tools/call` with proven zero-backend-execution guarantee on blocked/escalated calls.
- **Model Cryptographic Pinning**: Pinned to frozen $V_6$ revision `d59a6aa01f9139dff106146addb04109afa69c03`.
- **40 Automated Invariant & Security Tests**: 100% pass rate across arbiter dominance, authority monotonicity, fail-closed behavior, state isolation, fuzzing, and concurrency.
