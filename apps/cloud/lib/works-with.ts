/** Tools Mastyf connects to, shown in the ribbon under the home-page hero. */
export type WorksWith = { name: string; logo: string; href: string };

const L = '/logos/works-with';

export const WORKS_WITH: WorksWith[] = [
  { name: 'Claude Code', logo: `${L}/claude-code.svg`, href: '/docs/connect#supported-clients' },
  { name: 'Cursor', logo: `${L}/cursor.svg`, href: '/docs/connect#supported-clients' },
  { name: 'VS Code', logo: `${L}/vscode.svg`, href: '/docs/connect#supported-clients' },
  { name: 'GitHub Copilot', logo: `${L}/github-copilot.svg`, href: '/docs/connect#supported-clients' },
  { name: 'LangChain', logo: `${L}/langchain.svg`, href: '/docs/connect#langchain' },
  { name: 'OpenAI Agents', logo: `${L}/openai.svg`, href: '/docs/connect#openai-agents' },
  { name: 'Mastra', logo: `${L}/mastra.svg`, href: '/docs/connect#custom-agent' },
];
