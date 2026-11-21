import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Bot, Code2, GitPullRequest, Monitor, Terminal } from 'lucide-react';
import { LegacyDocsRedirect } from '@/components/docs/LegacyDocsRedirect';
import { DocPaths } from '@/components/docs/DocVisuals';
import { DOC_TOPICS, docHref } from '@/components/docs/topics';

export const metadata: Metadata = {
  title: 'Docs — Mastyf',
  description:
    'Mastyf documentation: the Python library, the check program and its API, GitHub Copilot hooks, rules, the Shield app, Protocol X, benchmarks, plans and help.',
};

export default function DocsIndexPage() {
  return (
    <main id="main" className="docs__main">
      <LegacyDocsRedirect />
      <header className="docs__intro">
        <h1>Documentation</h1>
        <p>Start with your agent.</p>
      </header>

      <DocPaths
        paths={[
          { href: '/docs/python', title: 'Python agent', line: 'LangChain, LangGraph, OpenAI Agents or your own loop.', Icon: Code2, tag: 'Free' },
          { href: '/docs/check', title: 'Any other language', line: 'Ask the local check API before each tool call.', Icon: Terminal, tag: 'Free' },
          { href: '/docs/copilot', title: 'GitHub Copilot', line: 'Hooks that check Copilot’s coding agent.', Icon: GitPullRequest, tag: 'Free' },
          { href: '/docs/shield', title: 'Claude Code, Cursor, VS Code', line: 'Shield protects them with no code changes.', Icon: Monitor, tag: 'Paid' },
          { href: '/docs/check#mcp', title: 'An MCP server', line: 'Put the checks in front of it with one command.', Icon: Bot, tag: 'Free' },
        ]}
      />

      <ul className="doc-topics">
        {DOC_TOPICS.map((topic) => (
          <li key={topic.slug}>
            <Link href={docHref(topic.slug)} className="doc-topic">
              <span className="doc-topic__title">
                {topic.title}
                <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="doc-topic__summary">{topic.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
