import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
function readJsonSafe(path) {
    if (!existsSync(path))
        return null;
    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    }
    catch {
        return null;
    }
}
export function evaluateMastyfAiCertification(repoRoot) {
    const parity = readJsonSafe(join(repoRoot, 'adversarial-harness', 'reports', 'parity-report.json'));
    const swarm = readJsonSafe(join(repoRoot, 'reports', 'security-swarm', 'report.json'));
    const checks = [
        {
            name: 'parity_full_match',
            passed: Number(parity?.['agreementRate'] || 0) >= 0.999,
            detail: `agreementRate=${String(parity?.['agreementRate'] ?? 'missing')}`,
        },
        {
            name: 'swarm_overall_pass',
            passed: Boolean(swarm?.['overall']) === true,
            detail: `overall=${String(swarm?.['overall'] ?? 'missing')}`,
        },
        {
            name: 'swarm_zero_net_new_bypass',
            passed: Number(swarm?.['bypasses']?.['netNew'] || -1) === 0,
            detail: `netNew=${String(swarm?.['bypasses']?.['netNew'] ?? 'missing')}`,
        },
    ];
    const passed = checks.filter((c) => c.passed).length;
    const level = passed === 3 ? 'gold' : passed === 2 ? 'silver' : passed === 1 ? 'bronze' : 'none';
    return {
        certified: passed >= 2,
        level,
        checks,
        issuedAt: new Date().toISOString(),
    };
}
export function buildPartnerSignalFeed(repoRoot) {
    const cert = evaluateMastyfAiCertification(repoRoot);
    return {
        generatedAt: new Date().toISOString(),
        certification: cert,
        signals: [
            { key: 'mastyf-ai_certified', value: cert.certified },
            { key: 'mastyf-ai_certification_level', value: cert.level },
            { key: 'mastyf-ai_checks_passed', value: cert.checks.filter((c) => c.passed).length },
        ],
    };
}
//# sourceMappingURL=mastyf-ai-certified-mcp.js.map