/**
 * Compliance Control Mapper — maps MCP Mastyf AI policy rules and blocked incidents
 * to compliance framework controls (SOC 2, HIPAA, PCI-DSS, FedRAMP, ISO 27001).
 *
 * Provides real-time compliance posture scoring and gap analysis.
 */

import { Logger } from '../../utils/logger.js';

export type ComplianceFramework = 'soc2' | 'hipaa' | 'pci-dss' | 'fedramp' | 'iso27001';

export interface ControlMapping {
  controlId: string;
  framework: ComplianceFramework;
  controlName: string;
  description: string;
  /** How this control is satisfied by Mastyf AI policies */
  satisfiedBy: string[];
  /** Whether this control is currently satisfied */
  satisfied: boolean;
  /** Gap description if not satisfied */
  gap?: string;
  /** Recommended policy to create */
  recommendedPolicy?: string;
}

export interface CompliancePosture {
  framework: ComplianceFramework;
  frameworkName: string;
  totalControls: number;
  satisfiedControls: number;
  partialControls: number;
  unsatisfiedControls: number;
  postureScore: number; // 0-100
  controls: ControlMapping[];
  /** Critical gaps that need immediate attention */
  criticalGaps: ControlMapping[];
  /** Summary for auditors */
  summary: string;
}

export class ControlMapper {
  /**
   * Evaluate compliance posture for a given framework.
   */
  evaluate(
    framework: ComplianceFramework,
    activePolicies: string[], // List of active policy rule names
    blockedIncidents: string[], // List of incident types blocked
  ): CompliancePosture {
    const controls = this.getFrameworkControls(framework);
    const evaluatedControls: ControlMapping[] = [];

    for (const control of controls) {
      const satisfied = this.evaluateControl(control, activePolicies, blockedIncidents);
      evaluatedControls.push(satisfied);
    }

    const satisfiedCount = evaluatedControls.filter(c => c.satisfied).length;
    const partialCount = evaluatedControls.filter(c => !c.satisfied && c.gap).length;
    const unsatisfiedCount = evaluatedControls.filter(c => !c.satisfied && !c.gap).length;

    const postureScore = Math.round((satisfiedCount / evaluatedControls.length) * 100);
    const criticalGaps = evaluatedControls.filter(c => !c.satisfied && c.gap && c.recommendedPolicy);

    return {
      framework,
      frameworkName: this.getFrameworkName(framework),
      totalControls: evaluatedControls.length,
      satisfiedControls: satisfiedCount,
      partialControls: partialCount,
      unsatisfiedControls: unsatisfiedCount,
      postureScore,
      controls: evaluatedControls,
      criticalGaps,
      summary: this.buildSummary(framework, postureScore, satisfiedCount, evaluatedControls.length, criticalGaps),
    };
  }

  /**
   * Evaluate a single compliance control against active policies.
   */
  private evaluateControl(
    control: { controlId: string; controlName: string; description: string; requirements: string[] },
    activePolicies: string[],
    blockedIncidents: string[],
  ): ControlMapping {
    // Check how many requirements are satisfied
    const satisfiedBy: string[] = [];
    const missing: string[] = [];

    for (const req of control.requirements) {
      const matchedPolicy = activePolicies.some(p =>
        p.toLowerCase().includes(req.toLowerCase()) ||
        req.toLowerCase().includes(p.toLowerCase()),
      );
      const matchedIncident = blockedIncidents.some(inc =>
        inc.toLowerCase().includes(req.toLowerCase()) ||
        req.toLowerCase().includes(inc.toLowerCase()),
      );
      const matched = matchedPolicy || matchedIncident;
      if (matched) {
        satisfiedBy.push(req);
      } else {
        missing.push(req);
      }
    }

    // Also check blocked incidents as evidence of security controls
    const incidentEvidence = blockedIncidents.filter(inc =>
      control.requirements.some(req =>
        inc.toLowerCase().includes(req.toLowerCase()) ||
        req.toLowerCase().includes(inc.toLowerCase()),
      ),
    );

    const satisfied = missing.length === 0;

    return {
      controlId: control.controlId,
      framework: 'soc2', // Will be overridden
      controlName: control.controlName,
      description: control.description,
      satisfiedBy: Array.from(new Set([...satisfiedBy, ...incidentEvidence])),
      satisfied,
      gap: !satisfied ? `Missing: ${missing.join(', ')}` : undefined,
      recommendedPolicy: !satisfied ? this.generateRecommendedPolicy(control, missing) : undefined,
    };
  }

  /**
   * Generate a recommended policy to satisfy a compliance gap.
   */
  private generateRecommendedPolicy(
    control: { controlId: string; controlName: string; description: string },
    missing: string[],
  ): string {
    const lines = [
      `# Recommended policy for ${control.controlId}: ${control.controlName}`,
      `# To satisfy: ${missing.join(', ')}`,
      `rules:`,
    ];

    if (control.controlName.toLowerCase().includes('access control')) {
      lines.push(`  - rule: deny_unauthorized_tools`);
      lines.push(`    description: "Enforce least privilege access"`);
    }
    if (control.controlName.toLowerCase().includes('audit')) {
      lines.push(`  - rule: audit_all_tool_calls`);
      lines.push(`    description: "Log all MCP tool invocations for audit trail"`);
      lines.push(`    audit: true`);
    }
    if (control.controlName.toLowerCase().includes('encryption')) {
      lines.push(`  - rule: enforce_encrypted_transport`);
      lines.push(`    description: "Require TLS for all HTTP/SSE MCP transports"`);
    }

    return lines.join('\n');
  }

  /**
   * Get the control definitions for a compliance framework.
   */
  private getFrameworkControls(framework: ComplianceFramework): {
    controlId: string;
    controlName: string;
    description: string;
    requirements: string[];
  }[] {
    const controls: Record<ComplianceFramework, {
      controlId: string;
      controlName: string;
      description: string;
      requirements: string[];
    }[]> = {
      soc2: [
        { controlId: 'CC6.1', controlName: 'Logical Access Control', description: 'Restrict access to systems and data based on role', requirements: ['access control', 'authentication', 'authorization'] },
        { controlId: 'CC6.6', controlName: 'External Communication Threats', description: 'Protect against threats from external communications', requirements: ['deny_shell', 'deny_path', 'input validation', 'injection'] },
        { controlId: 'CC6.8', controlName: 'Malicious Software Detection', description: 'Detect and prevent malicious software', requirements: ['command validation', 'executable', 'malicious'] },
        { controlId: 'CC7.2', controlName: 'System Monitoring', description: 'Monitor systems for anomalies', requirements: ['monitor', 'alert', 'logging', 'anomaly', 'detection'] },
        { controlId: 'CC7.3', controlName: 'Incident Response', description: 'Identify and respond to security incidents', requirements: ['incident', 'respond', 'alert', 'webhook'] },
      ],
      hipaa: [
        { controlId: '164.312(a)', controlName: 'Access Control', description: 'Implement technical access controls', requirements: ['access control', 'unique user', 'authentication'] },
        { controlId: '164.312(b)', controlName: 'Audit Controls', description: 'Record and examine activity', requirements: ['audit', 'logging', 'history'] },
        { controlId: '164.312(c)', controlName: 'Integrity Controls', description: 'Protect ePHI from improper alteration', requirements: ['integrity', 'hash', 'tamper'] },
        { controlId: '164.312(d)', controlName: 'Authentication', description: 'Verify entity identity', requirements: ['authentication', 'identity', 'dpop', 'token'] },
        { controlId: '164.312(e)', controlName: 'Transmission Security', description: 'Protect data in transit', requirements: ['encryption', 'tls', 'transport'] },
      ],
      'pci-dss': [
        { controlId: '7.1', controlName: 'Least Privilege Access', description: 'Limit access to cardholder data', requirements: ['least privilege', 'access control', 'role based'] },
        { controlId: '10.2', controlName: 'Automated Audit Trails', description: 'Create and retain audit trail entries', requirements: ['audit', 'logging', 'trail'] },
        { controlId: '11.4', controlName: 'Intrusion Detection', description: 'Detect and alert on intrusions', requirements: ['detection', 'alert', 'monitor', 'intrusion'] },
        { controlId: '2.2', controlName: 'Secure Configuration', description: 'Apply secure configuration standards', requirements: ['configuration', 'hardening', 'secure'] },
      ],
      fedramp: [
        { controlId: 'AC-2', controlName: 'Account Management', description: 'Manage system accounts', requirements: ['account', 'user management', 'access control'] },
        { controlId: 'AU-3', controlName: 'Content of Audit Records', description: 'Generate detailed audit records', requirements: ['audit', 'record', 'logging'] },
        { controlId: 'CM-7', controlName: 'Least Functionality', description: 'Configure least functionality', requirements: ['least privilege', 'minimal', 'whitelist'] },
        { controlId: 'IA-2', controlName: 'Identification and Authentication', description: 'Identify and authenticate users', requirements: ['authentication', 'identity', 'token'] },
        { controlId: 'SC-8', controlName: 'Transmission Confidentiality', description: 'Protect information during transmission', requirements: ['encryption', 'tls', 'confidentiality'] },
      ],
      iso27001: [
        { controlId: 'A.9.2.1', controlName: 'User Registration', description: 'Manage user registration process', requirements: ['registration', 'user'] },
        { controlId: 'A.9.4.2', controlName: 'Secure Log-on', description: 'Implement secure log-on procedures', requirements: ['authentication', 'secure logon'] },
        { controlId: 'A.12.4.1', controlName: 'Event Logging', description: 'Log events and produce log information', requirements: ['logging', 'event', 'audit'] },
        { controlId: 'A.12.6.1', controlName: 'Vulnerability Management', description: 'Manage technical vulnerabilities', requirements: ['vulnerability', 'cve', 'scan', 'patch'] },
        { controlId: 'A.14.2.5', controlName: 'System Security Principles', description: 'Apply secure design principles', requirements: ['least privilege', 'secure', 'principle'] },
      ],
    };

    return controls[framework] || [];
  }

  private getFrameworkName(framework: ComplianceFramework): string {
    const names: Record<ComplianceFramework, string> = {
      soc2: 'SOC 2 (Service Organization Control)',
      hipaa: 'HIPAA Security Rule',
      'pci-dss': 'PCI-DSS v4.0',
      fedramp: 'FedRAMP (Moderate)',
      iso27001: 'ISO/IEC 27001:2022',
    };
    return names[framework];
  }

  private buildSummary(
    framework: ComplianceFramework,
    score: number,
    satisfied: number,
    total: number,
    gaps: ControlMapping[],
  ): string {
    const name = this.getFrameworkName(framework);
    if (score >= 90) {
      return `${name}: ${score}% compliant (${satisfied}/${total} controls). Fully compliant posture.`;
    }
    if (score >= 70) {
      return `${name}: ${score}% compliant (${satisfied}/${total} controls). ${gaps.length} critical gaps requiring attention.`;
    }
    return `${name}: ${score}% compliant (${satisfied}/${total} controls). ${gaps.length} critical gaps — significant work needed.`;
  }
}