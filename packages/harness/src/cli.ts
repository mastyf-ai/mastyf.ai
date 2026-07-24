#!/usr/bin/env node
import { setupHarness, teardownHarness, setupAllHarnesses, getEnabledHarnesses } from './index.js';

const args = process.argv.slice(2);
const command = args[0];
const target = args[1] as string | undefined;

function printBanner() {
  console.log('');
  console.log('  \ud83d\udee1\ufe0f  mastyf.ai \u2014 Cross-Harness MCP Security');
  console.log('  Protect Claude Code, Cursor, Codex CLI, and Gemini CLI');
  console.log('');
}

function printHelp() {
  console.log('Usage:');
  console.log('  mastyf-harness setup [claude|cursor|codex|gemini|all]  Setup protection');
  console.log('  mastyf-harness teardown [claude|cursor|codex|gemini|all]  Remove protection');
  console.log('  mastyf-harness status                                  Check status');
  console.log('  mastyf-harness help                                    Show this');
  console.log('');
  console.log('Examples:');
  console.log('  npx @mastyf_ai/harness setup all     Protect everything');
  console.log('  npx @mastyf_ai/harness setup claude  Protect Claude Code only');
}

switch (command) {
  case 'setup': {
    if (!target || target === 'all') {
      printBanner();
      const results = setupAllHarnesses();
      console.log(`\nProtected: ${results.successes.join(', ') || 'none'}`);
      if (results.failures.length) console.log(`Skipped: ${results.failures.join(', ')}`);
    } else if (['claude', 'cursor', 'codex', 'gemini'].includes(target)) {
      printBanner();
      setupHarness(target as any);
    } else {
      printHelp();
    }
    break;
  }
  case 'teardown': {
    if (!target || target === 'all') {
      for (const h of ['claude', 'cursor', 'codex', 'gemini'] as const) {
        teardownHarness(h);
      }
      console.log('All harnesses removed.');
    } else if (['claude', 'cursor', 'codex', 'gemini'].includes(target)) {
      teardownHarness(target as any);
    } else {
      printHelp();
    }
    break;
  }
  case 'status': {
    const enabled = getEnabledHarnesses();
    if (enabled.length === 0) {
      console.log('No MCP configs are protected. Run "mastyf-harness setup all" to start.');
    } else {
      console.log(`Protected harnesses: ${enabled.join(', ')}`);
    }
    break;
  }
  default:
    printBanner();
    printHelp();
}
