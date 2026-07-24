# FedRAMP Moderate Compliance Mapping

mastyf.ai maps to the following FedRAMP control families.

## Access Control (AC)

| Control | mastyf Implementation |
|---------|----------------------|
| AC-2 — Account Management | User store with CRUD + setup API for first admin account |
| AC-3 — Access Enforcement | YAML policy engine enforcing per-role/per-user tool access |
| AC-6 — Least Privilege | Tool-level access control via policy rules |
| AC-7 — Unsuccessful Login Attempts | Login rate limiting (5 attempts/min per IP) + account lockout |
| AC-10 — Concurrent Session Control | Per-session rate limiting + session-based tool access |
| AC-14 — Permitted Actions without Identification | Open mode for local development (`DASHBOARD_AUTH_DISABLED=true`) |

## Audit and Accountability (AU)

| Control | mastyf Implementation |
|---------|----------------------|
| AU-2 — Audit Events | All policy decisions, login/logout, setup, tool calls |
| AU-3 — Content of Audit Records | Structured JSONL with timestamp, user, action, IP, tenant, decision |
| AU-4 — Audit Storage Capacity | File-based storage under `~/.mastyf-ai/tenants/{tenantId}/` |
| AU-6 — Audit Review, Analysis, and Reporting | SIEM export (CEF, LEEF) for existing monitoring tools |
| AU-8 — Time Stamps | RFC 3339 timestamps |
| AU-9 — Protection of Audit Information | SHA-256 hash chain + Ed25519 cryptographic receipts |
| AU-12 — Audit Generation | Automatic: all tool calls, policy decisions, auth events |

## Configuration Management (CM)

| Control | mastyf Implementation |
|---------|----------------------|
| CM-6 — Configuration Settings | Environment variable-based configuration with documented defaults |
| CM-7 — Least Functionality | Only required transports active; tool-level filtering |
| CM-8 — System Component Inventory | Fleet page showing all registered proxy instances |

## Identification and Authentication (IA)

| Control | mastyf Implementation |
|---------|----------------------|
| IA-2 — Identification and Authentication | Username/password + JWT session + API key + DPoP |
| IA-5 — Authenticator Management | Password policy (uppercase, no username, no email, minimum length) |
| IA-8 — Identification and Authentication (non-organizational) | GitHub OAuth + Google OAuth via cloud dashboard |

## System and Communications Protection (SC)

| Control | mastyf Implementation |
|---------|----------------------|
| SC-7 — Boundary Protection | SSRF blocking, localhost/metadata IP blocking, private subnet blocking |
| SC-8 — Transmission Confidentiality and Integrity | TLS for HTTP/SSE/WebSocket transports |
| SC-12 — Cryptographic Key Management | Ed25519 key generation and storage for receipt signing |
| SC-13 — Cryptographic Protection | AES-256-GCM field encryption + SHA-256 hash chains |
| SC-23 — Session Authenticity | JWT session tokens with configurable TTL + CSRF protection |
| SC-28 — Protection of Information at Rest | SQLite DB for history/auth + AES-256-GCM encryption |

## Evidence Generation

Run `pnpm enterprise:compliance-report --framework fedramp-moderate` to auto-generate compliance evidence with control-by-control mapping.
