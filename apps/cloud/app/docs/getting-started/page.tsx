import type { Metadata } from 'next';
import { Bot, Code2, GitPullRequest, Monitor, Terminal } from 'lucide-react';
import { DocPage, DocSection } from '@/components/docs/DocPage';
import { DocFlow, DocPaths, DocTable } from '@/components/docs/DocVisuals';

export const metadata: Metadata = {
  title: 'Getting started — Mastyf docs',
  description:
    'What Mastyf checks, what is free and what is paid, and which page to read next for your agent.',
};

export default function GettingStartedPage() {
  return (
    <DocPage slug="getting-started">
      <DocSection id="overview" title="What Mastyf does">
        <p>
          An AI agent acts through tools: it reads files, runs commands, queries databases and calls APIs. Mastyf sits
          between the agent and those tools and checks both directions.
        </p>
        <DocFlow
          label="A tool call on its way out"
          steps={[
            { label: 'Your agent', sub: 'asks to call a tool' },
            { label: 'Mastyf', sub: 'checks the call', tone: 'check' },
            { label: 'The tool', sub: 'runs only if allowed', tone: 'ok' },
          ]}
        />
        <DocFlow
          label="A tool result on its way back"
          steps={[
            { label: 'The tool', sub: 'returns a result' },
            { label: 'Mastyf', sub: 'checks the result', tone: 'check' },
            { label: 'Your model', sub: 'reads it only if safe', tone: 'ok' },
          ]}
        />
        <p>
          A blocked call never runs. A blocked result never reaches the model, and a secret in a result is replaced
          before the model sees it. The model is told which check stopped something, never the text that was matched.
        </p>
      </DocSection>

      <DocSection id="free-or-paid" title="Free or paid">
        <DocTable
          head={['', 'Free', 'Paid (Shield)']}
          rows={[
            ['Where it runs', 'On your own machine or server', 'The Shield app on Windows, plus Mastyf’s servers'],
            ['Account needed', 'No', 'Yes, with a licence key'],
            ['How you connect', 'A library in your code, a local service, or Copilot hooks', 'Shield sets up your desktop agents itself'],
            ['Checks', 'Fixed rules on calls and results', 'Everything in free, plus Protocol X, DIFC taint tracking, the argument-intent auditor and the causal gate'],
            ['Records', 'In your own logs', 'On your PC, plus a dashboard on mastyf.ai'],
            ['Licence', 'AGPL-3.0 engine, MIT libraries', 'Subscription'],
          ]}
        />
      </DocSection>

      <DocSection id="pick" title="Pick your path">
        <DocPaths
          paths={[
            {
              href: '/docs/python',
              title: 'Python agent',
              line: 'LangChain, LangGraph, the OpenAI Agents SDK or your own loop. pip install mastyf-ai.',
              Icon: Code2,
              tag: 'Free',
            },
            {
              href: '/docs/check',
              title: 'Agent in another language',
              line: 'Run the check program and ask its HTTP API before each tool call.',
              Icon: Terminal,
              tag: 'Free',
            },
            {
              href: '/docs/copilot',
              title: 'GitHub Copilot',
              line: 'Hooks in your repository check every tool call of Copilot’s coding agent.',
              Icon: GitPullRequest,
              tag: 'Free',
            },
            {
              href: '/docs/shield',
              title: 'Claude Code, Cursor, VS Code',
              line: 'Shield finds your desktop agents and protects them with no code changes.',
              Icon: Monitor,
              tag: 'Paid',
            },
            {
              href: '/docs/check#mcp',
              title: 'An MCP server',
              line: 'Put the checks in front of any stdio MCP server with one command.',
              Icon: Bot,
              tag: 'Free',
            },
          ]}
        />
      </DocSection>
    </DocPage>
  );
}
