// Copied from apps/cloud/lib/tier-features.ts (the list the mastyf.ai pricing page uses). Keep in sync.
/**
 * What the free tier and the paid tier each get. One list, used by the pricing page and the
 * Getting started docs so they can't drift apart. "coming" means built but not yet installable.
 */
export type TierFeature = { name: string; what: string; status: 'available' | 'coming'; href?: string };

/** Free: runs on your own machines and servers. No account, no Mastyf servers. */
export const FREE_FEATURES: TierFeature[] = [
  {
    name: 'Python library',
    what: 'pip install mastyf-ai. Checks every tool call your agent makes; adapters for LangChain and OpenAI Agents.',
    status: 'available',
    href: 'https://pypi.org/project/mastyf-ai/',
  },
  {
    name: 'JavaScript library',
    what: 'The same checks for Node agents, with an adapter for Mastra. Coming to npm.',
    status: 'coming',
  },
  {
    name: 'Check service',
    what: 'A small HTTP service you run yourself; any agent in any language asks it before running a tool.',
    status: 'available',
    href: '/docs/connect#custom-agent',
  },
  {
    name: 'GitHub Copilot hooks',
    what: 'Checks Copilot agent tool calls on your machine before they run.',
    status: 'available',
  },
  {
    name: 'Policy engine',
    what: 'Fixed rules in about 1.5 ms: blocked paths, secret and data-leak patterns, injection patterns, tool fingerprints.',
    status: 'available',
  },
  {
    name: 'Security Swarm and Threat Lab',
    what: 'Attack test sets you run against your own agents.',
    status: 'available',
  },
  {
    name: 'GitHub Action',
    what: 'Runs the checks in your CI on every pull request. Coming soon.',
    status: 'coming',
  },
];

/** Paid: the Mastyf Shield app plus Mastyf's servers. Includes everything in free. */
export const PAID_FEATURES: TierFeature[] = [
  {
    name: 'Shield desktop app',
    what: 'Windows app that finds your AI agents and protects them, with no code changes.',
    status: 'available',
    href: '/download',
  },
  {
    name: 'Automatic protection for Claude Code, Cursor and VS Code',
    what: 'Shield connects to these agents itself and checks every tool call they make.',
    status: 'available',
  },
  {
    name: 'Protocol X model checks',
    what: 'Our hosted model reads each call in context and catches attacks fixed rules miss, in about a second.',
    status: 'available',
    href: '/protocol-x',
  },
  {
    name: 'DIFC taint tracking',
    what: 'Marks data that came from untrusted places (web pages, emails, files) and stops it flowing out.',
    status: 'available',
  },
  {
    name: 'Argument-intent auditor (AIA)',
    what: 'Checks that a call’s arguments match what you actually asked the agent to do.',
    status: 'available',
  },
  {
    name: 'Causal gate',
    what: 'Stops tool calls that were set off by untrusted content instead of by you.',
    status: 'available',
  },
  {
    name: 'mastyf.ai dashboard',
    what: 'Every allowed and blocked call, with the reason, in your account on mastyf.ai.',
    status: 'available',
  },
  {
    name: 'Hosted check API',
    what: 'Custom agents send calls to Mastyf’s servers and get every paid layer, with nothing to run.',
    status: 'available',
  },
];
