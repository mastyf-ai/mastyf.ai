/**
 * CLI: full plain-English Mastyf AI analysis.
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import chalk from 'chalk';
import { createContainer } from '../container.js';
import { buildMastyfAiFullAnalysis } from '../ai/mastyf-ai-full-analysis.js';
import { DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
export async function runAnalyze(opts) {
    const tenantId = opts.tenantId || process.env.MASTYF_AI_TENANT_ID || DEFAULT_TENANT_ID;
    const container = await createContainer();
    try {
        const analysis = await buildMastyfAiFullAnalysis(container.db, tenantId, {
            windowDays: opts.window,
            useLlm: !opts.noLlm,
            historyDbAttached: true,
        });
        if (!analysis) {
            console.error(chalk.yellow('No analysis — history database empty or unavailable.'));
            console.error(chalk.dim('  Start the proxy with DASHBOARD_ENABLED=true and route MCP traffic through Mastyf AI.'));
            process.exit(1);
        }
        const output = opts.format === 'json' ? JSON.stringify(analysis, null, 2) : analysis.markdown;
        if (opts.output) {
            const outPath = resolve(opts.output);
            const dir = join(outPath, '..');
            if (!existsSync(dir))
                mkdirSync(dir, { recursive: true });
            writeFileSync(outPath, output, 'utf-8');
            console.error(chalk.green(`Analysis saved to ${outPath}`));
        }
        else {
            console.log(output);
        }
        if (!opts.noLlm && analysis.source === 'measured') {
            console.error(chalk.dim('  Tip: start Ollama (qwen3:8b) for a richer plain-English narrative, or set MASTYF_AI_FULL_ANALYSIS_LLM=true'));
        }
    }
    finally {
        container.db.close();
    }
}
//# sourceMappingURL=analyze.js.map