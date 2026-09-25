/** #10 One-Click MCP Configuration Hardening */
import { Logger } from '../../utils/logger.js';
export class ConfigHardener {
    analyze(server) {
        const recs = [];
        // Transport
        if (server.transport === 'stdio')
            recs.push({ category: 'transport', severity: 'low', finding: 'stdio transport — local only, no wire encryption', recommendation: 'Consider upgrading to mTLS HTTP for remote access', automatic: false });
        if (server.transport === 'http')
            recs.push({ category: 'transport', severity: 'critical', finding: 'HTTP without TLS — data sent in plaintext', recommendation: 'Switch to HTTPS or mTLS transport immediately', oneClickFix: 'Upgrade transport to mTLS', automatic: true });
        // Secrets
        const env = server.env || {};
        const envStr = JSON.stringify(env);
        if (envStr.includes('password') || envStr.includes('secret') || envStr.includes('token') || envStr.includes('key')) {
            recs.push({ category: 'secrets', severity: 'high', finding: 'Hardcoded credentials detected in environment variables', recommendation: 'Use a secrets vault (AWS Secrets Manager, HashiCorp Vault) or MCP Mastyf AI secret provider', automatic: false });
        }
        // Tools
        const hasExec = server.command?.match(/execute|exec|shell|bash|sh|run/i);
        if (hasExec)
            recs.push({ category: 'tools', severity: 'high', finding: 'Server command name suggests command execution capability', recommendation: 'Add strict argument allowlist to this tool', oneClickFix: 'Add deny rule for dangerous commands', automatic: true });
        // Policy
        recs.push({ category: 'policy', severity: 'medium', finding: 'No MCP Mastyf AI policy attached', recommendation: 'Apply default-policy.yaml for comprehensive protection', oneClickFix: 'Use default-policy.yaml with block mode', automatic: true });
        const criticalCount = recs.filter(r => r.severity === 'critical').length;
        const highCount = recs.filter(r => r.severity === 'high').length;
        const score = Math.max(0, 100 - criticalCount * 30 - highCount * 15 - recs.filter(r => r.severity === 'medium').length * 5);
        const grade = score >= 90 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : score >= 30 ? 'D' : 'F';
        Logger.info(`[ConfigHardener] ${server.name}: ${grade} (${score}/100), ${recs.length} recommendations`);
        return { serverName: server.name, score, grade, recommendations: recs.sort((a, b) => { const s = { critical: 0, high: 1, medium: 2, low: 3 }; return s[a.severity] - s[b.severity]; }) };
    }
}
//# sourceMappingURL=hardening-advisor.js.map