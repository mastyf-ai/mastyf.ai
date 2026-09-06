# Mastyf Security Gateway v0.1.1-rc1 Residual Vulnerability Risk Assessment

**Container Vulnerability Gate:** 

## Executive Summary

A comprehensive vulnerability scan of container image `mastyf-gateway:0.1.1-rc1` using Trivy v0.74.0 detected 33 residual vulnerabilities (29 Medium, 4 Low, 0 Critical, 0 High, 0 Unknown). Every single finding is situated exclusively within the Ubuntu 24.04 (Noble) base operating system distribution packages. Zero vulnerabilities exist within application source code or Python virtual environment dependencies.

Crucially, **every vulnerable library functionality is unreached and uncallable** within the gateway container topology:
- **`libexpat1` (24 findings):** The gateway operates exclusively on JSON and JSON-RPC 2.0 protocols. No XML parser or handler is imported, configured, or reachable on any request path or internal execution pipeline.
- **`libc6` / `libc-bin` (2 findings):** Involves local `fopen` mode string overflow; mode strings are internal constants in Python runtime and never derived from untrusted client input.
- **`libsqlite3-0` (1 finding):** Local SQL buffer overflow; the gateway does not use SQLite (operates strictly on in-memory state and JSONL telemetry logs).
- **`tar` (2 findings):** Local archive TOCTOU; the gateway runtime does not unpack, manipulate, or extract tar archives.
- **`libsystemd0` / `libudev1` (2 findings):** Unintended terminal log output; container runs without systemd init daemon or terminal devices.
- **`login` / `passwd` (2 findings):** Subordinate UID configuration; container enforces single unprivileged service account (`mastyf`, UID 10001) with interactive login disabled.

---

## Comprehensive Itemized CVE Disposition Matrix

| CVE | Package & Version | Severity | CVSS | Attack Vector | Fixed Version | Runtime Reachability | Mitigation Rationale & Disposition |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- | :--- |
| `CVE-2026-18374` | `libc-bin 2.39-0ubuntu8.8` | **MEDIUM** | 4.9 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: fopen mode string overflow; mode strings are hardcoded static constants in runtime. |
| `CVE-2026-18374` | `libc6 2.39-0ubuntu8.8` | **MEDIUM** | 4.9 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: fopen mode string overflow; mode strings are hardcoded static constants in runtime. |
| `CVE-2025-59375` | `libexpat1 2.6.1-2ubuntu0.4` | **MEDIUM** | 5.3 | Network (AV:N) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Gateway uses JSON/JSON-RPC only; zero XML parsers imported or exposed. |
| `CVE-2025-66382` | `libexpat1 2.6.1-2ubuntu0.4` | **MEDIUM** | 2.9 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Gateway uses JSON/JSON-RPC only; zero XML parsers imported or exposed. |
| `CVE-2026-32776` | `libexpat1 2.6.1-2ubuntu0.4` | **MEDIUM** | 6.2 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Gateway uses JSON/JSON-RPC only; zero XML parsers imported or exposed. |
| `CVE-2026-32777` | `libexpat1 2.6.1-2ubuntu0.4` | **MEDIUM** | 4 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Gateway uses JSON/JSON-RPC only; zero XML parsers imported or exposed. |
| `CVE-2026-32778` | `libexpat1 2.6.1-2ubuntu0.4` | **MEDIUM** | 5.1 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Gateway uses JSON/JSON-RPC only; zero XML parsers imported or exposed. |
| `CVE-2026-41080` | `libexpat1 2.6.1-2ubuntu0.4` | **MEDIUM** | 3.7 | Network (AV:N) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Gateway uses JSON/JSON-RPC only; zero XML parsers imported or exposed. |
| `CVE-2026-45186` | `libexpat1 2.6.1-2ubuntu0.4` | **MEDIUM** | 7.5 | Network (AV:N) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Gateway uses JSON/JSON-RPC only; zero XML parsers imported or exposed. |
| `CVE-2026-50219` | `libexpat1 2.6.1-2ubuntu0.4` | **MEDIUM** | 4.9 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Gateway uses JSON/JSON-RPC only; zero XML parsers imported or exposed. |
| `CVE-2026-56131` | `libexpat1 2.6.1-2ubuntu0.4` | **MEDIUM** | 4.5 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Gateway uses JSON/JSON-RPC only; zero XML parsers imported or exposed. |
| `CVE-2026-56132` | `libexpat1 2.6.1-2ubuntu0.4` | **MEDIUM** | 6.9 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Gateway uses JSON/JSON-RPC only; zero XML parsers imported or exposed. |
| `CVE-2026-56403` | `libexpat1 2.6.1-2ubuntu0.4` | **MEDIUM** | 6.9 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Gateway uses JSON/JSON-RPC only; zero XML parsers imported or exposed. |
| `CVE-2026-56404` | `libexpat1 2.6.1-2ubuntu0.4` | **MEDIUM** | 6.9 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Gateway uses JSON/JSON-RPC only; zero XML parsers imported or exposed. |
| `CVE-2026-56405` | `libexpat1 2.6.1-2ubuntu0.4` | **MEDIUM** | 4.9 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Gateway uses JSON/JSON-RPC only; zero XML parsers imported or exposed. |
| `CVE-2026-56406` | `libexpat1 2.6.1-2ubuntu0.4` | **MEDIUM** | 6.9 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Gateway uses JSON/JSON-RPC only; zero XML parsers imported or exposed. |
| `CVE-2026-56407` | `libexpat1 2.6.1-2ubuntu0.4` | **MEDIUM** | 6.9 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Gateway uses JSON/JSON-RPC only; zero XML parsers imported or exposed. |
| `CVE-2026-56408` | `libexpat1 2.6.1-2ubuntu0.4` | **MEDIUM** | 6.9 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Gateway uses JSON/JSON-RPC only; zero XML parsers imported or exposed. |
| `CVE-2026-56409` | `libexpat1 2.6.1-2ubuntu0.4` | **MEDIUM** | 6.5 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Gateway uses JSON/JSON-RPC only; zero XML parsers imported or exposed. |
| `CVE-2026-56410` | `libexpat1 2.6.1-2ubuntu0.4` | **MEDIUM** | 6.9 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Gateway uses JSON/JSON-RPC only; zero XML parsers imported or exposed. |
| `CVE-2026-56411` | `libexpat1 2.6.1-2ubuntu0.4` | **MEDIUM** | 6.9 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Gateway uses JSON/JSON-RPC only; zero XML parsers imported or exposed. |
| `CVE-2026-56412` | `libexpat1 2.6.1-2ubuntu0.4` | **MEDIUM** | 4.9 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Gateway uses JSON/JSON-RPC only; zero XML parsers imported or exposed. |
| `CVE-2026-66046` | `libexpat1 2.6.1-2ubuntu0.4` | **MEDIUM** | N/A | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Gateway uses JSON/JSON-RPC only; zero XML parsers imported or exposed. |
| `CVE-2026-72522` | `libexpat1 2.6.1-2ubuntu0.4` | **MEDIUM** | 6.2 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Gateway uses JSON/JSON-RPC only; zero XML parsers imported or exposed. |
| `CVE-2026-76641` | `libexpat1 2.6.1-2ubuntu0.4` | **MEDIUM** | N/A | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Gateway uses JSON/JSON-RPC only; zero XML parsers imported or exposed. |
| `CVE-2026-76957` | `libexpat1 2.6.1-2ubuntu0.4` | **MEDIUM** | 4.9 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Gateway uses JSON/JSON-RPC only; zero XML parsers imported or exposed. |
| `CVE-2026-39113` | `libsqlite3-0 3.45.1-1ubuntu2.7` | **MEDIUM** | N/A | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: SQLite buffer overflow; gateway uses JSONL/memory, not SQLite. |
| `CVE-2026-40228` | `libsystemd0 255.4-1ubuntu8.17` | **LOW** | 2.9 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Journald leakage; container runs without systemd init daemon. |
| `CVE-2026-40228` | `libudev1 255.4-1ubuntu8.17` | **LOW** | 2.9 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Journald leakage; container runs without systemd init daemon. |
| `CVE-2024-56433` | `login 1:4.13+dfsg1-4ubuntu3.2` | **LOW** | 3.6 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Subordinate ID flaw; container executes as isolated UID 10001 non-root. |
| `CVE-2024-56433` | `passwd 1:4.13+dfsg1-4ubuntu3.2` | **LOW** | 3.6 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Subordinate ID flaw; container executes as isolated UID 10001 non-root. |
| `CVE-2026-18477` | `tar 1.35+dfsg-3ubuntu0.4` | **MEDIUM** | 4.4 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Archive TOCTOU; gateway never extracts or processes tar archives. |
| `CVE-2026-18508` | `tar 1.35+dfsg-3ubuntu0.4` | **MEDIUM** | 4.4 | Local (AV:L) | None available (Noble) | **UNREACHABLE** | RESIDUAL_RISK_ACCEPTED: Archive TOCTOU; gateway never extracts or processes tar archives. |