# Enterprise Readiness Checklist

Status evidence links for sales and security reviews. Target: all rows **PRESENT**.

| Capability | Status | Evidence |
|------------|--------|----------|
| Audit logging | PRESENT | `policy_decision` on all transports; [enterprise-audit-all.yaml](../policy-templates/enterprise-audit-all.yaml) |
| TLS enforcement | PRESENT | `assertUpstreamTlsAllowed`; [values-enterprise.yaml](../deploy/helm/mastyf-ai/values-enterprise.yaml) |
| Metrics & monitoring | PRESENT | ServiceMonitor, PrometheusRule, Grafana ConfigMap |
| Rate limiting | PRESENT | Redis required; cloud Upstash; HTTP client + ingress limit (`MASTYF_AI_INGRESS_RATE_LIMIT_MAX`) |
| OWASP / CI | PRESENT | Security headers, Dependabot, gitleaks, Trivy, [ATTACK_MATRIX.md](../security/ATTACK_MATRIX.md) |
| Documentation | PRESENT | [ENTERPRISE_DEPLOYMENT.md](./ENTERPRISE_DEPLOYMENT.md), [COMPLIANCE.md](./COMPLIANCE.md) |
| CI/CD maturity | PRESENT | [CI_REQUIRED_CHECKS.md](./CI_REQUIRED_CHECKS.md), staging + production gates |
| Supply chain | PRESENT | SBOM on releases, policy-schema CI |
| Multi-tenancy | PRESENT | [tenant-api.ts](../src/control-plane/tenant-api.ts), gateway auth required |
| RBAC | PRESENT | Dashboard + cloud org roles, scoped API keys |
| Distributed tracing | PRESENT | OTel Helm wiring, traceparent propagation |
| Alerting | PRESENT | incident-responder, PrometheusRule → Alertmanager |
| Horizontal scaling | PRESENT | HPA, pod anti-affinity |
| High availability | PRESENT | PDB, PgBouncer deployment, backup PVC |
| Disaster recovery | PRESENT | [DISASTER_RECOVERY.md](./DISASTER_RECOVERY.md), `dr-drill.sh` |
| EU AI Act | PRESENT | [compliance/EU_AI_ACT.md](./compliance/EU_AI_ACT.md) |

Validate: `pnpm enterprise:evidence-check`
