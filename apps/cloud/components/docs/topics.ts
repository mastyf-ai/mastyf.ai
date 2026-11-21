/**
 * The documentation, one page per topic and one section per subtopic. The sidebar, the
 * /docs overview and each page's previous/next links all read this list, so a page's
 * sections here must match the DocSection ids it renders.
 */

export type DocSectionLink = { id: string; label: string };

export type DocTopic = {
  slug: string;
  title: string;
  summary: string;
  sections: DocSectionLink[];
};

export const DOC_TOPICS: DocTopic[] = [
  {
    slug: 'getting-started',
    title: 'Getting started',
    summary: 'Free libraries on your own servers, or the paid Shield app: what each gives you and which to pick.',
    sections: [
      { id: 'overview', label: 'Overview' },
      { id: 'free', label: 'Free: libraries' },
      { id: 'paid', label: 'Paid: Shield app' },
      { id: 'which', label: 'Which one do I need?' },
    ],
  },
  {
    slug: 'connect',
    title: 'Connect your agent',
    summary: 'Put Mastyf between your agent and its tools: Claude Desktop, Cursor, the OpenAI Agents SDK, LangChain or your own code.',
    sections: [
      { id: 'how-it-connects', label: 'How it connects' },
      { id: 'supported-clients', label: 'Supported clients' },
      { id: 'install', label: 'Install the gateway' },
      { id: 'desktop-apps', label: 'Claude Desktop, Cursor, Windsurf, Cline' },
      { id: 'shield', label: 'Shield desktop app' },
      { id: 'openai-agents', label: 'OpenAI Agents SDK' },
      { id: 'langchain', label: 'LangChain' },
      { id: 'custom-agent', label: 'Your own agent' },
      { id: 'cloud', label: 'Link to Mastyf Cloud' },
      { id: 'failure', label: 'If the proxy is down' },
    ],
  },
  {
    slug: 'how-it-works',
    title: 'How enforcement works',
    summary: 'The gates every tool call passes, a step-through decision console, and the platform components.',
    sections: [
      { id: 'gates', label: 'Enforcement gates' },
      { id: 'decision-console', label: 'Decision console' },
      { id: 'components', label: 'Platform components' },
      { id: 'integrations', label: 'Integrations' },
    ],
  },
  {
    slug: 'shield',
    title: 'Shield desktop app',
    summary: 'The desktop sidecar that checks every MCP tool call on your machine, with no cloud round trip.',
    sections: [{ id: 'shield-app', label: 'Shield desktop app' }],
  },
  {
    slug: 'protocol-x',
    title: 'Protocol X',
    summary: 'What Protocol X checks, where it runs in Shield, and how its results were measured.',
    sections: [
      { id: 'what', label: 'What it is' },
      { id: 'in-shield', label: 'What it does in Shield' },
      { id: 'how-measured', label: 'How we measured' },
      { id: 'limits', label: 'Limits' },
    ],
  },
  {
    slug: 'performance',
    title: 'Performance and benchmarks',
    summary: 'Latency and cost against cloud guardrails, adversarial benchmark results, and how Mastyf compares.',
    sections: [
      { id: 'cost', label: 'Performance and cost' },
      { id: 'benchmarks', label: 'Benchmarks' },
      { id: 'compare', label: 'How Mastyf compares' },
    ],
  },
  {
    slug: 'security-model',
    title: 'Guarantees and research',
    summary: 'What the architecture guarantees, its documented limits, the paper and proofs, and the threat landscape.',
    sections: [
      { id: 'guarantees', label: 'Guarantees and limits' },
      { id: 'paper', label: 'Paper and proofs' },
      { id: 'threats', label: 'Threat landscape' },
    ],
  },
  {
    slug: 'plans',
    title: 'Plans and licensing',
    summary: 'Every plan’s full feature list, and how licensing and payment work.',
    sections: [{ id: 'plans', label: 'Plans and licensing' }],
  },
  {
    slug: 'help',
    title: 'FAQ and help',
    summary: 'Answers to common questions, and how to reach us.',
    sections: [
      { id: 'faq', label: 'FAQ' },
      { id: 'contact', label: 'Get help' },
    ],
  },
];

export function docHref(slug: string, section?: string): string {
  return `/docs/${slug}${section ? `#${section}` : ''}`;
}

export function docTopic(slug: string): DocTopic {
  const topic = DOC_TOPICS.find((t) => t.slug === slug);
  if (!topic) throw new Error(`Unknown docs topic: ${slug}`);
  return topic;
}

/**
 * Where each section of the old single-page /docs now lives, so /docs#plans and the
 * like still land on the right page.
 */
export const LEGACY_DOC_ANCHORS: Record<string, string> = {
  overview: docHref('getting-started', 'overview'),
  quickstart: docHref('getting-started', 'free'),
  'how-it-works': docHref('how-it-works', 'gates'),
  components: docHref('how-it-works', 'components'),
  integrations: docHref('connect', 'supported-clients'),
  'shield-app': docHref('shield'),
  cost: docHref('performance', 'cost'),
  benchmarks: docHref('performance', 'benchmarks'),
  compare: docHref('performance', 'compare'),
  guarantees: docHref('security-model', 'guarantees'),
  paper: docHref('security-model', 'paper'),
  plans: docHref('plans'),
  threats: docHref('security-model', 'threats'),
  faq: docHref('help', 'faq'),
  help: docHref('help', 'contact'),
  // Linked from the site before, but never sections of the old page.
  gateway: docHref('how-it-works', 'components'),
  swarm: docHref('how-it-works', 'components'),
  'control-plane': docHref('how-it-works', 'components'),
};
