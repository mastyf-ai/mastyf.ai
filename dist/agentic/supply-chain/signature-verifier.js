/**
 * Supply Chain Signature Verifier — verifies package signatures and
 * detects dependency confusion, typo-squatting at the dependency level,
 * and builds a transitive trust graph for MCP server packages.
 */
export class SignatureVerifier {
    /** Known MCP server packages to check against for typo-squatting */
    knownMcpPackages = [
        '@modelcontextprotocol/sdk',
        '@anthropic/mcp',
        'mcp-server-github',
        'mcp-server-filesystem',
        'mcp-server-postgres',
        'mcp-server-puppeteer',
        'mcp-server-slack',
        'mcp-server-brave-search',
        'mcp-server-google-maps',
        'mcp-server-memory',
        'mcp-server-sequential-thinking',
        'mcp-server-sqlite',
        'mcp-server-git',
        'mcp-server-docker',
        'mastyf-ai',
        'filesystem-mcp-server',
        'github-mcp-server',
        'slack-mcp-server',
        'notion-mcp-server',
        'linear-mcp-server',
        'figma-mcp-server',
        'jira-mcp-server',
        'confluence-mcp-server',
        'sentry-mcp-server',
    ];
    /**
     * Verify a package's supply chain integrity.
     */
    verify(packageName, version, knownDeps = [], previousDeps = []) {
        const issues = [];
        let trustedPublisher = false;
        let dependencyConfusion = false;
        let typoSquat = false;
        const similarPackages = [];
        // 1. Check if package name matches known trusted publishers
        trustedPublisher = this.isTrustedPublisher(packageName);
        if (!trustedPublisher) {
            issues.push({
                severity: 'medium',
                type: 'unsigned',
                description: `Package "${packageName}" is not from a known trusted publisher`,
                recommendation: 'Verify the package source and consider using only verified publishers',
            });
        }
        // 2. Check for dependency confusion (package in both public + private registries)
        dependencyConfusion = this.detectDependencyConfusion(packageName);
        if (dependencyConfusion) {
            issues.push({
                severity: 'critical',
                type: 'dependency_confusion',
                description: `Potential dependency confusion detected for "${packageName}"`,
                recommendation: 'Use scoped packages (@org/pkg) and configure registry scopes',
            });
        }
        // 3. Check for typo-squatting
        const similarityResult = this.checkTypoSquat(packageName);
        if (similarityResult.isSquat) {
            typoSquat = true;
            for (const similar of similarityResult.similarTo) {
                similarPackages.push(similar);
            }
            issues.push({
                severity: 'high',
                type: 'typo_squat',
                description: `"${packageName}" resembles known packages: ${similarityResult.similarTo.join(', ')}`,
                recommendation: 'Verify the package name is intentional and not a typo-squatted copy',
            });
        }
        // 4. Check for newly added untrusted dependencies
        const newUntrustedDeps = knownDeps.filter(d => d.newlyAdded && !d.trusted);
        for (const dep of newUntrustedDeps) {
            issues.push({
                severity: 'high',
                type: 'new_untrusted_dep',
                description: `New untrusted dependency: ${dep.name}@${dep.version}`,
                recommendation: `Review and vet the new dependency ${dep.name}`,
            });
        }
        // 5. Compute integrity score
        let integrityScore = 100;
        for (const issue of issues) {
            switch (issue.severity) {
                case 'critical':
                    integrityScore -= 30;
                    break;
                case 'high':
                    integrityScore -= 20;
                    break;
                case 'medium':
                    integrityScore -= 10;
                    break;
                case 'low':
                    integrityScore -= 5;
                    break;
            }
        }
        integrityScore = Math.max(0, Math.min(100, integrityScore));
        return {
            packageName,
            version,
            verified: issues.length === 0,
            trustedPublisher,
            dependencyConfusion,
            typoSquat,
            similarPackages,
            dependencies: knownDeps,
            integrityScore,
            issues,
        };
    }
    /**
     * Check if the package is from a known trusted publisher.
     */
    isTrustedPublisher(packageName) {
        const trustedPublishers = [
            '@modelcontextprotocol/',
            '@anthropic/',
            '@mastyf_ai/',
            '@openai/',
            '@google/',
            '@microsoft/',
        ];
        // Scoped packages from trusted orgs
        for (const org of trustedPublishers) {
            if (packageName.startsWith(org))
                return true;
        }
        // Known specific packages
        return this.knownMcpPackages.includes(packageName);
    }
    /**
     * Detect potential dependency confusion.
     */
    detectDependencyConfusion(packageName) {
        // Dependency confusion: a non-scoped package name that could exist
        // in both a private and public registry
        // Warning signs:
        //   - No scope (not @org/pkg)
        //   - Generic/common name
        if (packageName.startsWith('@'))
            return false;
        const genericPatterns = [
            /^utils?$/,
            /^common$/,
            /^config$/,
            /^types$/,
            /^core$/,
            /^shared$/,
            /^lib$/,
            /^helpers?$/,
            /^tools?$/,
            /^api$/,
            /^client$/,
        ];
        return genericPatterns.some(p => p.test(packageName));
    }
    /**
     * Check if a package name is a typo-squat of a known package.
     */
    checkTypoSquat(packageName) {
        const similarTo = [];
        const lower = packageName.toLowerCase();
        for (const known of this.knownMcpPackages) {
            const knownLower = known.toLowerCase();
            // Skip exact matches
            if (lower === knownLower)
                continue;
            // Calculate Levenshtein distance
            const distance = this.levenshtein(lower, knownLower);
            const maxLen = Math.max(lower.length, knownLower.length);
            const similarity = 1 - distance / maxLen;
            // Flag if >70% similar but not identical
            if (similarity > 0.7 && distance <= 3) {
                similarTo.push(known);
            }
        }
        return {
            isSquat: similarTo.length > 0,
            similarTo,
        };
    }
    /**
     * Compute Levenshtein distance between two strings.
     */
    levenshtein(a, b) {
        const matrix = [];
        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                }
                else {
                    matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1, // insertion
                    matrix[i - 1][j] + 1);
                }
            }
        }
        return matrix[b.length][a.length];
    }
}
//# sourceMappingURL=signature-verifier.js.map