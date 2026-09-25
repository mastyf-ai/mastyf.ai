import chalk from 'chalk';
import { getFleetStatus } from '../fleet/fleet-aggregator.js';
import { exitUnlessProFeature } from '../license/enforce-pro.js';
export async function runFleetStatus(opts) {
    await exitUnlessProFeature('fleet');
    const report = await getFleetStatus();
    if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return 0;
    }
    console.log(chalk.bold.cyan(`\nMCP Mastyf AI Fleet — region ${report.region} (${report.source})\n`));
    console.log(chalk.dim(`  Instances: ${report.totalInstances} (${report.activeInstances} active)  |  ` +
        `Requests: ${report.totalRequests}  |  Blocked: ${report.totalBlocked}  |  ` +
        `Cost: $${report.totalCostUsd.toFixed(4)}\n`));
    if (report.instances.length === 0) {
        console.log(chalk.yellow('  No fleet data. Set DATABASE_URL + DB_TYPE=postgres or MASTYF_AI_FLEET_DB_PATHS.\n'));
        return 0;
    }
    for (const inst of report.instances) {
        const statusColor = inst.status === 'active' ? chalk.green : inst.status === 'degraded' ? chalk.yellow : chalk.red;
        console.log(`  ${statusColor(inst.status.padEnd(8))}  ${inst.instanceName.padEnd(24)}  ` +
            `req=${inst.totalRequests}  blocked=${inst.blockedRequests}  $${inst.totalCostUsd.toFixed(4)}` +
            (inst.region ? chalk.dim(`  region=${inst.region}`) : '') +
            (inst.dbPath ? chalk.dim(`  db=${inst.dbPath}`) : ''));
    }
    console.log('');
    return 0;
}
//# sourceMappingURL=fleet-status.js.map