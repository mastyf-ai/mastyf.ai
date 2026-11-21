import type { Metadata } from 'next';
import Link from 'next/link';
import { DocPage, DocSection } from '@/components/docs/DocPage';
import { DocTable } from '@/components/docs/DocVisuals';

export const metadata: Metadata = {
  title: 'Find your agent — Mastyf docs',
  description: 'Every kind of AI agent, and the Mastyf docs page that shows how to protect it.',
};

export default function ConnectYourAgentPage() {
  return (
    <DocPage slug="connect">
      <DocSection id="agents" title="Find your agent">
        <DocTable
          head={['Your agent', 'Protect it with', 'Plan']}
          rows={[
            ['Claude Code, Cursor, VS Code, Windsurf, Cline, Claude Desktop', <Link key="s" href="/docs/shield#connect">Shield: one switch</Link>, 'Paid'],
            ['Any other desktop agent that uses MCP', <Link key="o" href="/docs/shield#other-agents">Shield: setup prompt</Link>, 'Paid'],
            ['A LangChain agent (Python)', <Link key="lc" href="/docs/python#langchain">guard_tools()</Link>, 'Free'],
            ['A LangGraph agent', <Link key="lg" href="/docs/python#langgraph">guard_tool_node()</Link>, 'Free'],
            ['An OpenAI Agents SDK agent (Python)', <Link key="oa" href="/docs/python#openai-agents">guard_function_tools()</Link>, 'Free'],
            ['Your own Python tool loop', <Link key="g" href="/docs/python#any-framework">Guard</Link>, 'Free'],
            ['An agent in any other language', <Link key="api" href="/docs/check#api">The check API over HTTP</Link>, 'Free'],
            ['An MCP server used by any client', <Link key="mcp" href="/docs/check#mcp">mastyf-check proxy</Link>, 'Free'],
            ['GitHub Copilot’s coding agent', <Link key="cp" href="/docs/copilot">Hooks in your repository</Link>, 'Free'],
          ]}
        />
        <p className="doc-note">
          A JavaScript library for Mastra, LangChain.js and the OpenAI Agents SDK for TypeScript is built and coming to
          npm. Until then, Node agents use the <Link href="/docs/check#api">check API</Link>.
        </p>
      </DocSection>
    </DocPage>
  );
}
