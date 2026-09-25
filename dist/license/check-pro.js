#!/usr/bin/env node
/**
 * Legacy license check CLI — no-op (MIT open source).
 * Usage: node dist/license/check-pro.js swarm
 */
import { runCheckProCli } from './enforce-pro.js';
const code = await runCheckProCli(process.argv.slice(2));
process.exit(code);
//# sourceMappingURL=check-pro.js.map