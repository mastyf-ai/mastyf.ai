/**
 * CMQ CLI Command Implementations.
 *
 * Provides `mastyf boundary` subcommands:
 * - inspect: Level 1 & Level 2 declarative and environmental checks
 * - test: Level 3 active canary escape tests
 * - qualify: Full evidence-bound Complete-Mediation Qualification with Ed25519 attestation
 * - report: Formats and verifies an existing signed attestation
 * - template: Generates dual-network Docker and K8s boundary templates
 */
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { loadBoundaryManifest } from './manifest.js';
import { inspectTopology } from './inspector.js';
import { CMQCanaryHarness } from './canary-harness.js';
import { runEscapeSuite } from './escape-runner.js';
import { runCompleteMediationQualification, formatTerminalReport } from './qualifier.js';
import { generateDockerCompose, generateKubernetesNetworkPolicies } from './templates.js';
export async function handleBoundaryInspect(opts) {
    const manifest = loadBoundaryManifest(opts.manifest);
    console.log(chalk.bold(`\nScanning deployment topology for: ${manifest.deployment.name}...`));
    const report = await inspectTopology(manifest);
    console.log(chalk.dim('─'.repeat(74)));
    for (const f of report.findings) {
        const icon = f.severity === 'PASS'
            ? chalk.green('✓')
            : f.severity === 'WARN'
                ? chalk.yellow('⚠')
                : chalk.red('✗');
        const lvl = f.level === 'LEVEL_1_DECLARATIVE' ? chalk.dim('[L1-DECL]') : chalk.cyan('[L2-ENV]');
        console.log(`${icon} ${lvl} [${f.category.toUpperCase()}] ${chalk.bold(f.title)}`);
        console.log(`   ${chalk.dim(f.detail)}`);
        if (f.remediation) {
            console.log(`   ${chalk.cyan('Remediation:')} ${f.remediation}`);
        }
    }
    console.log(chalk.dim('─'.repeat(74)));
    const verdictColor = report.verdict === 'INSPECT_PASSED'
        ? chalk.green.bold('INSPECT PASSED')
        : report.verdict === 'INSPECT_WARNING'
            ? chalk.yellow.bold('INSPECT WARNING')
            : chalk.red.bold('INSPECT FAILED');
    console.log(`Verdict: ${verdictColor} (${report.passCount} pass, ${report.warnCount} warn, ${report.failCount} fail) | Direct Routes: ${report.directRoutesDetected} | Leaked Creds: ${report.credentialPathsDetected}\n`);
}
export async function handleBoundaryTest(opts) {
    const manifest = loadBoundaryManifest(opts.manifest);
    console.log(chalk.bold(`\nSpawning CMQ Canary Harness and testing 15 boundary escape vectors...`));
    const harness = new CMQCanaryHarness(opts.canaryId);
    const endpoints = await harness.start();
    console.log(chalk.dim(`Canary active: HTTP port ${endpoints.httpPort}, TCP port ${endpoints.tcpPort}`));
    try {
        const results = await runEscapeSuite(manifest, harness);
        console.log(chalk.dim('─'.repeat(74)));
        for (const r of results) {
            const icon = r.result === 'PASS' ? chalk.green('✓') : chalk.red('✗');
            console.log(`${icon} ${chalk.bold(r.title)} ➔ ${r.result === 'PASS' ? chalk.green('BLOCKED') : chalk.red('BYPASSED')}`);
            console.log(`   ${chalk.dim(r.details)}`);
        }
        console.log(chalk.dim('─'.repeat(74)));
        const unauthorized = harness.getUnauthorizedSideEffectsCount();
        if (unauthorized === 0) {
            console.log(chalk.green.bold(`✓ SUCCESS: 0 unauthorized side-effects observed outside Mastyf.\n`));
        }
        else {
            console.log(chalk.red.bold(`✗ VIOLATION: ${unauthorized} unauthorized side-effects reached canary directly!\n`));
        }
    }
    finally {
        await harness.stop();
    }
}
export async function handleBoundaryQualify(opts) {
    const manifest = loadBoundaryManifest(opts.manifest);
    const runCycle = async () => {
        const report = await runCompleteMediationQualification(manifest);
        if (opts.json) {
            console.log(JSON.stringify(report, null, 2));
        }
        else {
            console.log(formatTerminalReport(report));
        }
        const outputPath = opts.output || path.join(process.cwd(), 'cmq-attestation.json');
        fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
        if (!opts.json) {
            console.log(chalk.dim(`Signed evidence attestation saved to: ${outputPath}\n`));
        }
        const strictlyQualified = report.verdict === 'QUALIFIED' &&
            report.inspection.directRoutesDetected === 0 &&
            report.inspection.credentialPathsDetected === 0 &&
            report.tests.unauthorizedSideEffects === 0 &&
            report.tests.unmediatedSuccesses === 0 &&
            report.tests.failed === 0;
        if (opts.requireQualified && !strictlyQualified) {
            console.error(chalk.red.bold(`\n[CI/CD GATE FAILED] Deployment failed strict Complete Mediation qualification requirement! Verdict: ${report.verdict} (direct_routes: ${report.inspection.directRoutesDetected}, leaked_creds: ${report.inspection.credentialPathsDetected}, unauthorized_side_effects: ${report.tests.unauthorizedSideEffects}, test_failures: ${report.tests.failed})\n`));
            process.exitCode = 1;
        }
        else if (report.verdict === 'FAILED' || report.verdict === 'NOT_QUALIFIABLE') {
            process.exitCode = 1;
        }
        return report;
    };
    if (opts.continuous) {
        const intervalSec = typeof opts.interval === 'number' ? opts.interval : parseInt(String(opts.interval || '300'), 10);
        console.log(chalk.cyan.bold(`Starting Continuous CMQ Requalification (cycle every ${intervalSec}s)...`));
        await runCycle();
        setInterval(async () => {
            console.log(chalk.dim(`\n[${new Date().toISOString()}] Executing continuous requalification cycle...`));
            await runCycle();
        }, intervalSec * 1000);
    }
    else {
        await runCycle();
    }
}
export async function handleBoundaryReport(opts) {
    const certPath = opts.cert || path.join(process.cwd(), 'cmq-attestation.json');
    if (!fs.existsSync(certPath)) {
        console.error(chalk.red(`No CMQ attestation found at ${certPath}. Run 'mastyf boundary qualify' first.`));
        process.exitCode = 1;
        return;
    }
    try {
        const raw = fs.readFileSync(certPath, 'utf-8');
        const report = JSON.parse(raw);
        console.log(formatTerminalReport(report));
    }
    catch (err) {
        console.error(chalk.red(`Failed to parse attestation certificate: ${String(err)}`));
        process.exitCode = 1;
    }
}
export async function handleBoundaryTemplate(opts) {
    const manifest = loadBoundaryManifest(opts.manifest);
    const outDir = opts.outputDir || process.cwd();
    const templateType = opts.type || 'all';
    if (templateType === 'docker' || templateType === 'all') {
        const dockerContent = generateDockerCompose(manifest);
        const dockerPath = path.join(outDir, 'docker-compose.boundary.yml');
        fs.writeFileSync(dockerPath, dockerContent, 'utf-8');
        console.log(chalk.green(`✓ Generated Docker dual-network isolation template: ${dockerPath}`));
    }
    if (templateType === 'k8s' || templateType === 'all') {
        const k8sContent = generateKubernetesNetworkPolicies(manifest);
        const k8sPath = path.join(outDir, 'k8s-network-policy.yaml');
        fs.writeFileSync(k8sPath, k8sContent, 'utf-8');
        console.log(chalk.green(`✓ Generated Kubernetes strict NetworkPolicy template: ${k8sPath}`));
    }
}
//# sourceMappingURL=cli-commands.js.map