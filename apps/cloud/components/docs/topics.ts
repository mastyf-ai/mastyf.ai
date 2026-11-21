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
    summary: 'What Mastyf checks, what is free and what is paid, and which page to read next.',
    sections: [
      { id: 'overview', label: 'What Mastyf does' },
      { id: 'free-or-paid', label: 'Free or paid' },
      { id: 'pick', label: 'Pick your path' },
    ],
  },
  {
    slug: 'python',
    title: 'Python library',
    summary: 'pip install mastyf-ai: guard the tools of a LangChain, LangGraph, OpenAI Agents or hand-written agent.',
    sections: [
      { id: 'install', label: 'Install' },
      { id: 'langchain', label: 'LangChain' },
      { id: 'langgraph', label: 'LangGraph' },
      { id: 'openai-agents', label: 'OpenAI Agents SDK' },
      { id: 'any-framework', label: 'Any other framework' },
      { id: 'sessions', label: 'Many users, one agent' },
      { id: 'unavailable', label: 'When no check can be made' },
      { id: 'settings', label: 'Settings and commands' },
      { id: 'upgrade', label: 'Upgrading from 4.x' },
    ],
  },
  {
    slug: 'check',
    title: 'Check program and API',
    summary: 'The free check engine as one program: run it as a local HTTP service for any language, or in front of an MCP server.',
    sections: [
      { id: 'download', label: 'Download' },
      { id: 'commands', label: 'Commands' },
      { id: 'mcp', label: 'In front of an MCP server' },
      { id: 'api', label: 'HTTP API' },
      { id: 'verdict', label: 'The verdict' },
      { id: 'example', label: 'A tool loop, end to end' },
    ],
  },
  {
    slug: 'copilot',
    title: 'GitHub Copilot',
    summary: 'Hooks that check every tool call of GitHub Copilot’s coding agent in your repository.',
    sections: [
      { id: 'setup', label: 'Set up' },
      { id: 'what-happens', label: 'What happens in a session' },
      { id: 'limits', label: 'Limits' },
    ],
  },
  {
    slug: 'rules',
    title: 'Rules',
    summary: 'What the free checks block out of the box, and how to write your own rules file.',
    sections: [
      { id: 'default', label: 'What is blocked by default' },
      { id: 'results', label: 'Checks on tool results' },
      { id: 'own-rules', label: 'Your own rules file' },
      { id: 'fields', label: 'Rule fields' },
      { id: 'observe', label: 'Try rules without blocking' },
    ],
  },
  {
    slug: 'shield',
    title: 'Shield app',
    summary: 'The paid Windows app: it protects Claude Code, Cursor, VS Code and other desktop agents with no code changes.',
    sections: [
      { id: 'install', label: 'Install' },
      { id: 'activate', label: 'Activate' },
      { id: 'connect', label: 'Connect your agents' },
      { id: 'test', label: 'Check it works' },
      { id: 'other-agents', label: 'Any other agent' },
      { id: 'libraries', label: 'With the libraries' },
      { id: 'records', label: 'What is recorded' },
      { id: 'receipts', label: 'Signed receipts' },
      { id: 'teams', label: 'Teams' },
      { id: 'off', label: 'Turning it off' },
    ],
  },
  {
    slug: 'connect',
    title: 'Find your agent',
    summary: 'Every kind of agent, and the page that shows how to protect it.',
    sections: [{ id: 'agents', label: 'Find your agent' }],
  },
  {
    slug: 'how-it-works',
    title: 'How enforcement works',
    summary: 'The checks every tool call and result passes, in order, with real recorded verdicts.',
    sections: [
      { id: 'calls', label: 'A tool call' },
      { id: 'results', label: 'A tool result' },
      { id: 'recorded', label: 'Recorded verdicts' },
      { id: 'shield-adds', label: 'What Shield adds' },
      { id: 'fail-closed', label: 'When no check can be made' },
    ],
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
  quickstart: docHref('python', 'install'),
  'how-it-works': docHref('how-it-works', 'calls'),
  components: docHref('how-it-works', 'shield-adds'),
  integrations: docHref('connect', 'agents'),
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
  gateway: docHref('check', 'mcp'),
  swarm: docHref('how-it-works'),
  'control-plane': docHref('shield', 'records'),
};
