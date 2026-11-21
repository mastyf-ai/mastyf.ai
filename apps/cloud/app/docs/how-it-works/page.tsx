import type { Metadata } from 'next';
import Link from 'next/link';
import { DecisionConsole } from '@/components/docs/DecisionConsole';
import { DocPage, DocSection } from '@/components/docs/DocPage';
import { Integrations } from '@/components/docs/Integrations';
import { PlatformComponents, ShieldGates } from '@/components/docs/PlatformComponents';

export const metadata: Metadata = {
  title: 'How enforcement works — Mastyf docs',
  description: 'The gates every agent tool call passes before it reaches a tool, a step-through decision console, and the platform components.',
};

export default function HowItWorksPage() {
  return (
    <DocPage slug="how-it-works">
      <DocSection id="gates" title="Enforcement gates">
        <p>
          Mastyf sits on the MCP transport between the agent and its tools. Every tool invocation is intercepted and
          evaluated before dispatch. Shield runs four gates in order; if any check fails, the call is severed before a
          single byte reaches the backend.
        </p>
        <div className="doc-block">
          <ShieldGates />
        </div>
      </DocSection>

      <DocSection id="decision-console" title="Decision console">
        <p>
          Step through four tool calls and see the decision for each: the client, the invariant that fired, and what
          reached the tool.
        </p>
        <div className="doc-block">
          <DecisionConsole />
        </div>
      </DocSection>

      <DocSection id="components" title="Platform components">
        <p>Five components, from a developer desktop sidecar to enterprise fleet governance.</p>
        <div className="doc-block">
          <PlatformComponents />
        </div>
      </DocSection>

      <DocSection id="integrations" title="Integrations">
        <p>
          Works with any client, IDE, or framework that speaks the Model Context Protocol. For step-by-step setup, see{' '}
          <Link href="/docs/connect">Connect your agent</Link>.
        </p>
        <div className="doc-block">
          <Integrations />
        </div>
      </DocSection>
    </DocPage>
  );
}
