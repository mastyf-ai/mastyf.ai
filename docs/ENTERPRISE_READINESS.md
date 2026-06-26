# Enterprise Readiness Checklist

Status evidence links for sales and security reviews. Capabilities marked **PRESENT** require Helm/env configuration documented in [ENTERPRISE_DEPLOYMENT.md](./ENTERPRISE_DEPLOYMENT.md) — they are not enabled in zero-config dev mode.

| Capability | Status | Evidence |
|------------|--------|----------|
| Audit logging | PRESENT | `policy_decision` on all transports; [enterprise-audit-all.yaml](../policy-templates/enterprise-audit-all.yaml) |
| TLS enforcement | PRESENT | `assertUpstreamTlsAllowed`; [values-enterprise.yaml](../deploy/helm/mastyf-ai/values-enterprise.yaml) |
| Metrics & monitoring | PRESENT | ServiceMonitor, PrometheusRule (correct `mastyf_ai_*` metrics), Grafana ConfigMap, in-app WS dashboard |
| Rate limiting | PRESENT | Redis required; cloud Upstash; HTTP client + ingress limit (`MASTYF_AI_INGRESS_RATE_LIMIT_MAX`) |
| OWASP / CI | PRESENT | Security headers, Dependabot, gitleaks, Trivy, [ATTACK_MATRIX.md](../security/ATTACK_MATRIX.md) |
| Documentation | PRESENT | [ENTERPRISE_DEPLOYMENT.md](./ENTERPRISE_DEPLOYMENT.md), [COMPLIANCE.md](./COMPLIANCE.md) |
| CI/CD maturity | PRESENT | [CI_REQUIRED_CHECKS.md](./CI_REQUIRED_CHECKS.md), staging + production gates |
| Supply chain | PRESENT | SBOM on releases, policy-schema CI |
| Multi-tenancy | PRESENT | [tenant-api.ts](../src/control-plane/tenant-api.ts), gateway auth required |
| RBAC | PRESENT | Dashboard + cloud org roles, scoped API keys |
| Distributed tracing | PRESENT | OTel OTLP + W3C `traceparent` on proxy upstream; requires `OTEL_EXPORTER_OTLP_ENDPOINT` |
| Alerting | PRESENT | App webhooks (`ALERT_SLACK_WEBHOOK`, `ALERT_PAGERDUTY_KEY`), `notifyToolBlock` on all transports, PrometheusRule, AlertmanagerConfig, `MASTYF_AI_ALERTING_REQUIRED` |
| Encryption at rest | PRESENT | `MASTYF_AI_DB_ENCRYPTION_KEY` required in enterprise; Helm ExternalSecret `db-encryption-key` |
| Unified spend pool | PRESENT | Atomic multi-window Lua + reservation rollback in [`unified-spend-pool.ts`](../src/services/unified-spend-pool.ts); `pnpm scenario:budget-flood` |
| Semantic profiles | PRESENT | `MASTYF_AI_SEMANTIC_PROFILE`, [`values-balanced.yaml`](../deploy/helm/mastyf-ai/values-balanced.yaml), [`values-enterprise.yaml`](../deploy/helm/mastyf-ai/values-enterprise.yaml) |
| Horizontal scaling | PRESENT | HPA, pod anti-affinity |
| High availability | PRESENT | PDB, PgBouncer deployment, backup PVC |
| Disaster recovery | PRESENT | [DISASTER_RECOVERY.md](./DISASTER_RECOVERY.md), `dr-drill.sh` |
| EU AI Act | PRESENT | [compliance/EU_AI_ACT.md](./compliance/EU_AI_ACT.md) |

Validate: `pnpm enterprise:evidence-check`
