/**
 * CLI: guardian threat-model
 */
import { writeFileSync } from 'fs';
import {
  generateThreatModelFromConfig,
  threatModelToMarkdown,
} from '../agentic/threat-modeling/stride-linddun.js';

export function runThreatModelCli(opts: {
  config: string;
  format: 'markdown' | 'json';
  output?: string;
  activePolicies?: string[];
}): { markdown?: string; report: unknown } {
  const activePolicies = opts.activePolicies ?? [];
  const report = generateThreatModelFromConfig(opts.config, activePolicies);

  if (opts.format === 'markdown') {
    const markdown = threatModelToMarkdown(report);
    if (opts.output) writeFileSync(opts.output, markdown, 'utf-8');
    return { markdown, report };
  }
  if (opts.output) writeFileSync(opts.output, JSON.stringify(report, null, 2), 'utf-8');
  return { report };
}
