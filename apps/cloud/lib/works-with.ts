/** Tools Mastyf connects to, shown in the ribbon under the home-page hero. */
export type WorksWith = { name: string; logo: string; href: string };

const L = '/logos/works-with';

export const WORKS_WITH: WorksWith[] = [
  { name: 'Claude Code', logo: `${L}/claude-code.svg`, href: '/docs/shield#connect' },
  { name: 'Cursor', logo: `${L}/cursor.svg`, href: '/docs/shield#connect' },
  { name: 'VS Code', logo: `${L}/vscode.svg`, href: '/docs/shield#connect' },
  { name: 'GitHub Copilot', logo: `${L}/github-copilot.svg`, href: '/docs/copilot' },
  { name: 'LangChain', logo: `${L}/langchain.svg`, href: '/docs/python#langchain' },
  { name: 'OpenAI Agents', logo: `${L}/openai.svg`, href: '/docs/python#openai-agents' },
  { name: 'Mastra', logo: `${L}/mastra.svg`, href: '/docs/check#api' },
];
