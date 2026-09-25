/**
 * CLI: mastyf-ai certify publish — scan, score, and publish badge to cloud.
 */
import chalk from 'chalk';
import { ConfigParser } from '../config-parser.js';
import { runCertifyPublish } from '../agentic/certification/certify-publish.js';
export async function runCertifyPublishCli(opts) {
    const cloudUrl = opts.cloudUrl
        || process.env.MASTYF_AI_CONTROL_PLANE_URL
        || process.env.MASTYF_AI_CLOUD_URL
        || 'https://mastyf-ai-cloud.vercel.app';
    let serverConfig;
    const configPath = opts.config || ConfigParser.findConfigPaths()[0];
    if (configPath) {
        const servers = ConfigParser.parse(configPath);
        serverConfig = servers.find((s) => s.name === opts.server);
    }
    const result = await runCertifyPublish({
        serverName: opts.server,
        packageName: opts.package,
        version: opts.version,
        cloudUrl,
        apiKey: opts.apiKey || process.env.MASTYF_AI_CLOUD_API_KEY,
        dbPath: opts.db,
        server: serverConfig,
    });
    if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
    }
    else {
        const c = result.certification;
        console.log(chalk.green(`Certified ${opts.package} — ${c.level} (${c.score}/100)`));
        console.log(chalk.dim(`Cloud id: ${result.cloudId ?? '—'}`));
        console.log(chalk.dim(`Verify: ${result.verifyUrl}`));
        console.log('');
        console.log('Embed in README:');
        console.log(result.badgeMarkdown);
    }
    return result.certification.certified ? 0 : 1;
}
//# sourceMappingURL=certify-cmd.js.map