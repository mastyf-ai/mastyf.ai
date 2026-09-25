/**
 * MCP Mastyf AI Trust Score — Like SSL Labs for MCP servers.
 *
 * Computes a 0-100 trust score per MCP server based on:
 *   1. CVE posture (known CVEs × CVSS severity, exploit maturity)
 *   2. Authentication strength (none < API key < OAuth2 < OAuth2+mTLS)
 *   3. Transport security (stdio < HTTP < HTTPS < mTLS)
 *   4. Tool capability risk surface (read vs write vs exec vs network)
 *   5. Supply chain integrity (trusted publisher, no typo-squat, no dep confusion)
 *   6. Observed attack history (blocked calls, bypasses, incident frequency)
 *   7. Response hygiene (does the server leak secrets/PII in responses?)
 *   8. Configuration freshness (last patched, age of known CVEs)
 *
 * Score tiers:
 *   A+ (90-100): Enterprise-ready
 *   A  (80-89):  Production-ready
 *   B  (60-79):  Needs hardening
 *   C  (40-59):  Significant gaps
 *   D  (20-39):  High risk
 *   F  (0-19):   Unsafe
 */
import { computeTrustGrade, trustGradeColor, } from './trust-badge-grade.js';
export class MastyfAiScore {
    /**
     * Compute a trust score from available inputs.
     */
    compute(input) {
        const categories = [
            this.scoreCvePosture(input),
            this.scoreAuthentication(input),
            this.scoreTransport(input),
            this.scoreCapability(input),
            this.scoreSupplyChain(input),
            this.scoreAttackHistory(input),
            this.scoreResponseHygiene(input),
            this.scoreProtectionLayer(input),
        ];
        // Compute weighted overall
        const overallScore = Math.round(categories.reduce((sum, c) => sum + (c.score / c.maxScore) * c.weight * 100, 0));
        const grade = this.computeGrade(overallScore);
        const badge = this.computeBadge(grade);
        const improvementActions = this.generateImprovements(categories, grade);
        return {
            serverName: input.serverName,
            overallScore,
            grade,
            categories,
            computedAt: new Date().toISOString(),
            includesLiveData: input.blockedCalls > 0 || input.responseDlpActive,
            improvementActions,
            badge,
        };
    }
    /** Score CVE posture (0-100, weight 0.25) */
    scoreCvePosture(input) {
        let score = 100;
        // Deduct for each CVE based on CVSS
        if (input.maxCvss > 0) {
            score -= Math.min(input.maxCvss * 8, 60); // CVSS 7.5 → -60
            score -= Math.min(input.cveCount * 3, 30); // 10 CVEs → -30
        }
        // Deduct for old unpatched CVEs
        if (input.newestCveAgeDays > 90)
            score -= 10;
        if (input.newestCveAgeDays > 365)
            score -= 10;
        const findings = [];
        if (input.cveCount > 0)
            findings.push(`${input.cveCount} known CVEs (max CVSS ${input.maxCvss.toFixed(1)})`);
        if (input.newestCveAgeDays > 90)
            findings.push(`Oldest unpatched CVE is ${input.newestCveAgeDays} days old`);
        if (input.cveCount === 0)
            findings.push('No known CVEs — excellent posture');
        return {
            name: 'CVE Posture',
            score: Math.max(0, score),
            weight: 0.25,
            maxScore: 100,
            details: `${input.cveCount} CVEs, max CVSS ${input.maxCvss.toFixed(1)}`,
            findings,
        };
    }
    /** Score authentication strength (0-100, weight 0.15) */
    scoreAuthentication(input) {
        const scores = {
            none: 0,
            api_key: 40,
            oauth2: 70,
            oauth2_mtls: 100,
        };
        return {
            name: 'Authentication',
            score: scores[input.authMethod] || 0,
            weight: 0.15,
            maxScore: 100,
            details: `Method: ${input.authMethod}`,
            findings: [input.authMethod === 'none' ? 'No authentication configured — critical gap' : `Using ${input.authMethod} authentication`],
        };
    }
    /** Score transport security (0-100, weight 0.15) */
    scoreTransport(input) {
        const scores = {
            stdio: 40,
            http: 20,
            https: 70,
            mTLS: 100,
        };
        return {
            name: 'Transport Security',
            score: scores[input.transport] || 30,
            weight: 0.15,
            maxScore: 100,
            details: `Transport: ${input.transport}`,
            findings: [input.transport === 'stdio' ? 'Local-only transport — low network risk but no wire encryption' : input.transport === 'http' ? 'HTTP without TLS — critical gap' : `Using ${input.transport}`],
        };
    }
    /** Score tool capability risk (0-100, weight 0.12) */
    scoreCapability(input) {
        if (input.totalToolCount === 0) {
            return { name: 'Tool Capability', score: 50, weight: 0.12, maxScore: 100, details: 'No tools — unknown risk', findings: ['No tools detected'] };
        }
        const highRiskRatio = input.highRiskToolCount / input.totalToolCount;
        const mediumRiskRatio = input.mediumRiskToolCount / input.totalToolCount;
        let score = 100;
        score -= highRiskRatio * 60; // 50% high-risk → -30
        score -= mediumRiskRatio * 20; // 50% medium-risk → -10
        const findings = [];
        if (input.highRiskToolCount > 0)
            findings.push(`${input.highRiskToolCount} high-risk tools (execute, shell, delete, etc.)`);
        if (input.mediumRiskToolCount > 0)
            findings.push(`${input.mediumRiskToolCount} medium-risk tools (write, create, send, etc.)`);
        if (input.highRiskToolCount === 0 && input.mediumRiskToolCount === 0)
            findings.push('All tools are read-only — excellent posture');
        return {
            name: 'Tool Capability',
            score: Math.max(0, Math.round(score)),
            weight: 0.12,
            maxScore: 100,
            details: `${input.totalToolCount} tools (${input.highRiskToolCount} high-risk, ${input.mediumRiskToolCount} medium-risk)`,
            findings,
        };
    }
    /** Score supply chain integrity (0-100, weight 0.12) */
    scoreSupplyChain(input) {
        let score = 100;
        const findings = [];
        if (!input.trustedPublisher) {
            score -= 25;
            findings.push('Not from a trusted publisher');
        }
        if (input.typoSquatDetected) {
            score -= 40;
            findings.push('Typo-squatting detected — potential malicious impersonation');
        }
        if (input.depConfusionDetected) {
            score -= 30;
            findings.push('Dependency confusion risk detected');
        }
        if (input.trustedPublisher && !input.typoSquatDetected && !input.depConfusionDetected) {
            findings.push('Clean supply chain');
        }
        return {
            name: 'Supply Chain',
            score: Math.max(0, score),
            weight: 0.12,
            maxScore: 100,
            details: `Trusted: ${input.trustedPublisher}, Typo-squat: ${input.typoSquatDetected}, Dep confusion: ${input.depConfusionDetected}`,
            findings,
        };
    }
    /** Score attack history (0-100, weight 0.10) */
    scoreAttackHistory(input) {
        let score = 100;
        const findings = [];
        if (input.bypassedAttacks > 0) {
            score -= Math.min(input.bypassedAttacks * 15, 60);
            findings.push(`${input.bypassedAttacks} bypassed attacks — policy gaps exist`);
        }
        if (input.blockedCalls > 0) {
            findings.push(`${input.blockedCalls} attack attempts blocked — defenses working`);
        }
        if (input.blockedCalls === 0 && input.bypassedAttacks === 0) {
            findings.push('No observed attack activity');
        }
        return {
            name: 'Attack History',
            score: Math.max(0, score),
            weight: 0.10,
            maxScore: 100,
            details: `${input.blockedCalls} blocked, ${input.bypassedAttacks} bypassed`,
            findings,
        };
    }
    /** Score response hygiene / DLP (0-100, weight 0.06) */
    scoreResponseHygiene(input) {
        return {
            name: 'Response Hygiene',
            score: input.responseDlpActive ? 100 : 30,
            weight: 0.06,
            maxScore: 100,
            details: `Response DLP: ${input.responseDlpActive ? 'Active' : 'Inactive'}`,
            findings: [input.responseDlpActive ? 'Response DLP is active — data leaks are blocked' : 'Response DLP is not active — tool responses may leak sensitive data'],
        };
    }
    /** Score Mastyf AI protection layer (0-100, weight 0.05) */
    scoreProtectionLayer(input) {
        return {
            name: 'Mastyf AI Protection',
            score: input.mastyfAiProtected ? 100 : 0,
            weight: 0.05,
            maxScore: 100,
            details: `Behind MastyfAi: ${input.mastyfAiProtected ? 'Yes' : 'No'}`,
            findings: [input.mastyfAiProtected ? 'Protected by MCP Mastyf AI proxy' : 'Not behind Mastyf AI — no policy enforcement, no audit, no DLP'],
        };
    }
    /** Compute letter grade. */
    computeGrade(score) {
        return computeTrustGrade(score);
    }
    /** Compute badge. */
    computeBadge(grade) {
        return {
            grade,
            color: trustGradeColor(grade),
            text: `MCP Mastyf AI Score: ${grade}`,
        };
    }
    /** Generate improvement actions. */
    generateImprovements(categories, grade) {
        const actions = [];
        for (const cat of categories) {
            if (cat.score < cat.maxScore * 0.5) {
                let action = '';
                let expected = 0;
                let effort = 'days';
                switch (cat.name) {
                    case 'CVE Posture':
                        action = 'Apply all available security patches and update to latest versions';
                        expected = Math.round((cat.maxScore - cat.score) * cat.weight);
                        effort = 'hours';
                        break;
                    case 'Authentication':
                        action = 'Configure OAuth 2.1 with mTLS for all HTTP/SSE transports';
                        expected = Math.round((100 - cat.score) * cat.weight);
                        effort = 'days';
                        break;
                    case 'Transport Security':
                        action = 'Upgrade to mTLS transport or route through Mastyf AI proxy';
                        expected = Math.round((100 - cat.score) * cat.weight);
                        effort = 'hours';
                        break;
                    case 'Tool Capability':
                        action = 'Restrict high-risk tools to read-only mode where possible';
                        expected = Math.round((cat.maxScore - cat.score) * cat.weight * 0.5);
                        effort = 'hours';
                        break;
                    case 'Supply Chain':
                        action = 'Switch to a trusted publisher package and enable dependency verification';
                        expected = Math.round((100 - cat.score) * cat.weight);
                        effort = 'hours';
                        break;
                    case 'Response Hygiene':
                        action = 'Enable Mastyf AI Response DLP to prevent data leaks';
                        expected = Math.round((100 - cat.score) * cat.weight);
                        effort = 'hours';
                        break;
                    case 'Mastyf AI Protection':
                        action = 'Place this server behind MCP Mastyf AI proxy for policy enforcement, audit, and DLP';
                        expected = Math.round((100 - cat.score) * cat.weight);
                        effort = 'hours';
                        break;
                    default:
                        action = `Improve ${cat.name.toLowerCase()} score`;
                        expected = 5;
                }
                actions.push({
                    priority: cat.score < 30 ? 'immediate' : cat.score < 60 ? 'high' : 'medium',
                    category: cat.name,
                    action,
                    expectedScoreIncrease: expected,
                    effort,
                });
            }
        }
        return actions.sort((a, b) => {
            const p = { immediate: 0, high: 1, medium: 2, low: 3 };
            return p[a.priority] - p[b.priority];
        });
    }
}
//# sourceMappingURL=mastyf-ai-score.js.map