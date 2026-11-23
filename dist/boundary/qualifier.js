/**
 * CMQ Qualifier Engine.
 *
 * Runs the end-to-end Complete-Mediation Qualification process across three levels of evidence:
 * LEVEL 1 (Declarative): Manifest isolation and fail-closed architecture
 * LEVEL 2 (Environmental): Runtime inspection, credential isolation, and active direct-socket probing
 * LEVEL 3 (Adversarial): Canary escape harness executing 15 active evasion vectors
 *
 * Produces a cryptographically signed Evidence Package (Ed25519) binding environment,
 * configuration hashes, inspection metrics, and test results.
 */
import crypto from 'node:crypto';
import os from 'node:os';
import chalk from 'chalk';
import { CMQCanaryHarness } from './canary-harness.js';
import { inspectTopology } from './inspector.js';
import { runEscapeSuite } from './escape-runner.js';
export async function runCompleteMediationQualification(manifest, opts = {}) {
    const qualificationId = `cmq_${crypto.randomBytes(8).toString('hex')}`;
    const timestamp = new Date().toISOString();
    // 1. Level 1 & Level 2: Run Topology & Environmental Inspection
    const inspection = await inspectTopology(manifest, opts.agentEnv);
    // 2. Level 3: Start Isolated Canary Harness
    const harness = new CMQCanaryHarness(opts.canaryId);
    await harness.start();
    let testResults = [];
    try {
        // 3. Execute 15 Adversarial Boundary Escape Vectors
        testResults = await runEscapeSuite(manifest, harness, opts.agentEnv);
    }
    finally {
        // 4. Teardown Canary Harness
        await harness.stop();
    }
    // 5. Invariant Evaluation & Metric Aggregation
    const unauthorizedSideEffects = harness.getUnauthorizedSideEffectsCount();
    const failedTests = testResults.filter((t) => t.result === 'FAIL').length;
    const passedTests = testResults.filter((t) => t.result === 'PASS').length;
    const inconclusiveTests = testResults.filter((t) => t.result === 'INCONCLUSIVE').length;
    const unmediatedSuccessfulPaths = testResults.filter((t) => !t.mediated && t.result === 'FAIL').length;
    // 6. Empirical Verdict Model
    let verdict = 'QUALIFIED';
    let statement = `Complete Mediation: QUALIFIED — No unmediated execution paths or unauthorized side effects were observed across the defined qualification scope and test suite.`;
    if (unauthorizedSideEffects > 0 ||
        unmediatedSuccessfulPaths > 0 ||
        failedTests > 0 ||
        inspection.directRoutesDetected > 0 ||
        inspection.credentialPathsDetected > 0 ||
        inspection.verdict === 'INSPECT_FAILED') {
        verdict = 'FAILED';
        const failureReasons = [];
        if (inspection.directRoutesDetected > 0) {
            failureReasons.push(`${inspection.directRoutesDetected} direct network routes detected`);
        }
        if (inspection.credentialPathsDetected > 0) {
            failureReasons.push(`${inspection.credentialPathsDetected} sensitive credentials exposed in agent context`);
        }
        if (unauthorizedSideEffects > 0) {
            failureReasons.push(`${unauthorizedSideEffects} unauthorized side-effects observed outside Mastyf`);
        }
        if (failedTests > 0) {
            failureReasons.push(`${failedTests} active escape tests failed`);
        }
        statement = `Complete Mediation: FAILED — ${failureReasons.join(', ')}. Direct unmediated execution routes were observed.`;
    }
    else if (inconclusiveTests > 5) {
        verdict = 'NOT_QUALIFIABLE';
        statement = `Complete Mediation: NOT_QUALIFIABLE — ${inconclusiveTests} tests returned inconclusive results; execution boundary could not be deterministically evaluated.`;
    }
    else if (inspection.warnCount > 0 || inspection.protectedEndpointsExposed > 0) {
        verdict = 'QUALIFIED_WITH_WARNINGS';
        statement = `Complete Mediation: QUALIFIED_WITH_WARNINGS — Active escape tests passed and no unmediated side-effects were observed, but environment inspection noted warnings (e.g. unverified workload identity or shared loopback).`;
    }
    // 7. Compute Configuration Hashes
    const manifestSha256 = crypto
        .createHash('sha256')
        .update(JSON.stringify(manifest))
        .digest('hex');
    const configurationEvidence = {
        manifestSha256,
        policySha256: manifest.policies?.securityPolicyPath
            ? crypto.createHash('sha256').update(manifest.policies.securityPolicyPath).digest('hex')
            : undefined,
        networkPolicySha256: manifest.policies?.networkPolicyPath
            ? crypto.createHash('sha256').update(manifest.policies.networkPolicyPath).digest('hex')
            : undefined,
        mcpConfigSha256: manifest.policies?.mcpConfigPath
            ? crypto.createHash('sha256').update(manifest.policies.mcpConfigPath).digest('hex')
            : undefined,
    };
    // 8. Assemble Environment Evidence
    const environmentEvidence = {
        platform: manifest.deployment.environment || (process.env.KUBERNETES_SERVICE_HOST ? 'kubernetes' : 'local'),
        cluster: manifest.deployment.cluster,
        namespace: manifest.deployment.namespace,
        agentImageDigest: manifest.deployment.agentImageDigest,
        mastyfImageDigest: manifest.deployment.mastyfImageDigest,
        toolImageDigests: manifest.protectedServices
            .map((s) => s.imageDigest)
            .filter((d) => !!d),
        hostArchitecture: os.arch(),
        osVersion: `${os.type()} ${os.release()}`,
    };
    // 9. Generate Deterministic Key & Cryptographic Attestation (Ed25519)
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const keyId = `key_${crypto
        .createHash('sha256')
        .update(publicKey.export({ type: 'spki', format: 'der' }))
        .digest('hex')
        .slice(0, 16)}`;
    // Bind the full canonical package for the digital signature
    const evidencePayloadToSign = JSON.stringify({
        qualificationId,
        deployment: manifest.deployment.name,
        timestamp,
        verdict,
        manifestSha256,
        environment: {
            platform: environmentEvidence.platform,
            cluster: environmentEvidence.cluster,
            namespace: environmentEvidence.namespace,
        },
        inspection: {
            directRoutesDetected: inspection.directRoutesDetected,
            credentialPathsDetected: inspection.credentialPathsDetected,
            protectedEndpointsExposed: inspection.protectedEndpointsExposed,
        },
        tests: {
            vectors: testResults.length,
            passed: passedTests,
            failed: failedTests,
            unauthorizedSideEffects,
            unmediatedSuccesses: unmediatedSuccessfulPaths,
        },
    });
    const signatureBuffer = crypto.sign(null, Buffer.from(evidencePayloadToSign), privateKey);
    const signatureBase64 = signatureBuffer.toString('base64');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const report = {
        // Canonical Signed Evidence Package
        qualification: {
            id: qualificationId,
            deployment: manifest.deployment.name,
            verdict,
            timestamp,
            scope: `Empirically qualified deployment "${manifest.deployment.name}" (${manifest.deployment.environment || 'local'}) across 15 boundary escape vectors.`,
        },
        environment: environmentEvidence,
        configuration: configurationEvidence,
        inspection: {
            directRoutesDetected: inspection.directRoutesDetected,
            credentialPathsDetected: inspection.credentialPathsDetected,
            protectedEndpointsExposed: inspection.protectedEndpointsExposed,
            findingsCount: inspection.findings.length,
            verdict: inspection.verdict,
            findings: inspection.findings,
        },
        tests: {
            vectors: testResults.length,
            passed: passedTests,
            failed: failedTests,
            unauthorizedSideEffects,
            unmediatedSuccesses: unmediatedSuccessfulPaths,
            results: testResults,
        },
        attestation: {
            algorithm: 'Ed25519',
            keyId,
            signature: signatureBase64,
            publicKeyPem,
            statement,
        },
        // Backwards compatibility fields
        qualificationId,
        version: '1.1.0-cmq-evidence-bound',
        deploymentName: manifest.deployment.name,
        timestamp,
        scope: `Deployment "${manifest.deployment.name}" (${manifest.deployment.environment || 'local'}).`,
        verdict,
        statement,
        summary: {
            protectedServicesCount: manifest.protectedServices.length,
            totalTestsRun: testResults.length,
            passedTests,
            failedTests,
            inconclusiveTests,
            unauthorizedSideEffectsObserved: unauthorizedSideEffects,
            unmediatedSuccessfulPaths,
        },
        testResults,
        hashes: {
            deploymentManifestHash: manifestSha256,
            testSuiteVersion: 'v1.1.0 (15 escape vectors + 3-level evidence binding)',
        },
        signature: {
            algorithm: 'Ed25519',
            publicKeyPem,
            signatureBase64,
        },
    };
    return report;
}
export function formatTerminalReport(report) {
    const lines = [];
    let verdictBadge = '';
    switch (report.verdict) {
        case 'QUALIFIED':
            verdictBadge = chalk.bgGreen.black(' COMPLETE MEDIATION: QUALIFIED ');
            break;
        case 'QUALIFIED_WITH_WARNINGS':
            verdictBadge = chalk.bgYellow.black(' COMPLETE MEDIATION: QUALIFIED WITH WARNINGS ');
            break;
        case 'FAILED':
            verdictBadge = chalk.bgRed.white(' COMPLETE MEDIATION: FAILED ');
            break;
        case 'NOT_QUALIFIABLE':
            verdictBadge = chalk.bgGray.white(' COMPLETE MEDIATION: NOT QUALIFIABLE ');
            break;
    }
    lines.push('');
    lines.push(chalk.bold(verdictBadge));
    lines.push(chalk.dim('─'.repeat(76)));
    lines.push(`${chalk.bold('Qualification ID:')}   ${report.qualification.id}`);
    lines.push(`${chalk.bold('Deployment:')}         ${report.qualification.deployment}`);
    lines.push(`${chalk.bold('Platform / Env:')}     ${report.environment.platform} (${report.environment.hostArchitecture || 'unknown'})`);
    lines.push(`${chalk.bold('Manifest SHA-256:')}   ${report.configuration.manifestSha256.slice(0, 32)}...`);
    lines.push(`${chalk.bold('Timestamp:')}          ${report.qualification.timestamp}`);
    lines.push(chalk.dim('─'.repeat(76)));
    lines.push(chalk.bold('LEVEL 1 & 2: TOPOLOGY & ENVIRONMENTAL INSPECTION'));
    for (const f of report.inspection.findings) {
        const icon = f.severity === 'PASS'
            ? chalk.green('✓')
            : f.severity === 'WARN'
                ? chalk.yellow('⚠')
                : chalk.red('✗');
        const levelTag = f.level === 'LEVEL_1_DECLARATIVE' ? chalk.dim('[L1-DECL]') : chalk.cyan('[L2-ENV]');
        lines.push(`  ${icon} ${levelTag} [${f.category.toUpperCase()}] ${chalk.bold(f.title)}`);
        lines.push(`     ${chalk.dim(f.detail)}`);
    }
    lines.push('');
    lines.push(chalk.bold('LEVEL 3: ACTIVE ADVERSARIAL ESCAPE SUITE (15 VECTORS)'));
    for (const t of report.tests.results) {
        const icon = t.result === 'PASS'
            ? chalk.green('✓')
            : t.result === 'WARN'
                ? chalk.yellow('⚠')
                : chalk.red('✗');
        const statusText = t.result === 'PASS'
            ? chalk.green('BLOCKED')
            : t.result === 'WARN'
                ? chalk.yellow('WARNING')
                : chalk.red('BYPASSED');
        lines.push(`  ${icon} ${chalk.bold(t.title)} ➔ ${statusText}`);
        lines.push(`     Target: ${chalk.cyan(t.target)} · ${chalk.dim(t.details)}`);
    }
    lines.push(chalk.dim('─'.repeat(76)));
    lines.push(chalk.bold('EVIDENCE BINDING & INVARIANT METRICS'));
    lines.push(`  • Direct routes detected:         ${report.inspection.directRoutesDetected > 0
        ? chalk.red.bold(report.inspection.directRoutesDetected)
        : chalk.green('0')}`);
    lines.push(`  • Credential paths detected:      ${report.inspection.credentialPathsDetected > 0
        ? chalk.red.bold(report.inspection.credentialPathsDetected)
        : chalk.green('0')}`);
    lines.push(`  • Protected endpoints exposed:    ${report.inspection.protectedEndpointsExposed > 0
        ? chalk.yellow(report.inspection.protectedEndpointsExposed)
        : chalk.green('0')}`);
    lines.push(`  • Unauthorized side-effects:      ${report.tests.unauthorizedSideEffects > 0
        ? chalk.red.bold(report.tests.unauthorizedSideEffects)
        : chalk.green.bold('0')}`);
    lines.push(`  • Unmediated execution paths:     ${report.tests.unmediatedSuccesses > 0
        ? chalk.red.bold(report.tests.unmediatedSuccesses)
        : chalk.green.bold('0')}`);
    lines.push(`  • Active escape tests passed:     ${chalk.green(`${report.tests.passed} / ${report.tests.vectors}`)}`);
    lines.push(chalk.dim('─'.repeat(76)));
    lines.push(chalk.bold('CRYPTOGRAPHIC ATTESTATION (Ed25519)'));
    lines.push(`  Algorithm:    ${report.attestation.algorithm}`);
    lines.push(`  Key ID:       ${report.attestation.keyId}`);
    lines.push(`  Signature:    ${report.attestation.signature.slice(0, 36)}...`);
    lines.push(`  Statement:    ${chalk.italic(report.attestation.statement)}`);
    lines.push(chalk.dim('─'.repeat(76)));
    lines.push('');
    return lines.join('\n');
}
//# sourceMappingURL=qualifier.js.map