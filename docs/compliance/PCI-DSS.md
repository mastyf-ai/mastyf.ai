# PCI DSS 4.0 Compliance Mapping

mastyf.ai maps to the following PCI DSS requirements.

## Requirement 6: Develop and Maintain Secure Systems and Software

| Requirement | mastyf Implementation |
|-------------|----------------------|
| 6.3.1 — Security vulnerabilities identified | CVE feed integration (OSV.dev) for MCP package vulnerability detection |
| 6.4.2 — Public-facing web apps protected | SSRF blocking, SQL/NoSQL injection blocking, XSS patterns |
| 6.5.1 — Change control procedures | Policy versioning with audit trail, rug-pull drift detection |

## Requirement 10: Log and Monitor All Access

| Requirement | mastyf Implementation |
|-------------|----------------------|
| 10.2.1 — Audit logs for individual access | Dashboard access logs to `dashboard-access.jsonl` |
| 10.2.2 — Actions taken by privileged users | RBAC with role-level audit logging |
| 10.3 — Audit log contents | Structured JSONL audit entries with timestamp, user, action, IP, decision |
| 10.4 — Time synchronization | RFC 3339 timestamps on all events |
| 10.5 — Audit log protection | SHA-256 hash chain with cryptographic receipts (Ed25519) |
| 10.7 — Audit log review | SIEM export (CEF, LEEF, JSONL) for existing log management infrastructure |

## Requirement 11: Test Security of Systems and Networks

| Requirement | mastyf Implementation |
|-------------|----------------------|
| 11.3 — External and internal vulnerability scans | CVE scanning + trust scoring for all MCP packages |
| 11.4 — Intrusion detection/prevention | 6-phase Defense Fabric: lifecycle \u2192 pre-guard \u2192 hooks \u2192 policy \u2192 semantic \u2192 spend |

## Evidence Generation

Run `pnpm enterprise:compliance-report --framework pci-dss` to auto-generate evidence from audit trails and corpus evaluation reports.
