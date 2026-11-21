import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Download } from 'lucide-react';
import { DocCode } from '@/components/docs/DocCode';
import { DocPage, DocSection } from '@/components/docs/DocPage';
import { FeatureList } from '@/components/pricing/FreeVsPaid';
import { FREE_FEATURES, PAID_FEATURES } from '@/lib/tier-features';

export const metadata: Metadata = {
  title: 'Getting started — Mastyf docs',
  description:
    'How Mastyf is set up: free libraries and a check service on your own servers, or the paid Shield app with Mastyf’s hosted protection.',
};

export default function GettingStartedPage() {
  return (
    <DocPage slug="getting-started">
      <DocSection id="overview" title="Overview">
        <p>
          Mastyf checks every tool call an AI agent makes (reading a file, running a command, sending a request)
          and stops the unsafe ones before they run. There are two ways to use it.
        </p>
        <dl className="doc-list">
          <div>
            <dt>Free, on your own servers</dt>
            <dd>
              Add the library to your agent&rsquo;s code, or run the check service next to it. Fixed rules, no account,
              nothing leaves your machines.
            </dd>
          </div>
          <div>
            <dt>Paid, with the Shield app</dt>
            <dd>
              Install Mastyf Shield on Windows. It finds your agents and protects them with no code changes, and adds
              Mastyf&rsquo;s hosted layers: Protocol X, DIFC taint tracking, the argument-intent auditor, the causal
              gate and your dashboard on mastyf.ai.
            </dd>
          </div>
        </dl>
      </DocSection>

      <DocSection id="free" title="Free: libraries and the check service">
        <p>For developers building their own agents. Everything here runs on your infrastructure.</p>
        <DocCode code="pip install mastyf-ai" label="Install the Python library" />
        <p>
          The Python library wraps your agent&rsquo;s tools so each call is checked first. It has adapters for
          LangChain and OpenAI Agents. For other languages, run the check service and ask it before each call.
        </p>
        <div className="doc-block">
          <FeatureList items={FREE_FEATURES} />
        </div>
        <p>
          <Link href="/docs/connect#install" className="link-icon">
            Install and connect
            <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </p>
      </DocSection>

      <DocSection id="paid" title="Paid: the Shield app">
        <p>
          For people using Claude Code, Cursor, VS Code or a custom agent who want the full protection. Shield
          runs on Windows and connects to Mastyf&rsquo;s servers with your license key. Everything in Free is
          included.
        </p>
        <div className="doc-block">
          <FeatureList items={PAID_FEATURES} />
        </div>
        <p>
          <Link href="/download" className="btn btn-primary btn-sm">
            <Download size={13} strokeWidth={2} aria-hidden="true" />
            Download Shield
          </Link>{' '}
          <Link href="/pricing" className="link-icon">
            See prices
            <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </p>
      </DocSection>

      <DocSection id="which" title="Which one do I need?">
        <dl className="doc-list">
          <div>
            <dt>You write the agent&rsquo;s code</dt>
            <dd>Start free with the Python library. Add the hosted check API later if you want the paid layers.</dd>
          </div>
          <div>
            <dt>You use Claude Code, Cursor or VS Code</dt>
            <dd>Use Shield. These agents aren&rsquo;t yours to change, so Shield connects to them for you.</dd>
          </div>
          <div>
            <dt>You use GitHub Copilot</dt>
            <dd>The free Copilot hooks check its calls locally; Shield adds the hosted layers.</dd>
          </div>
        </dl>
      </DocSection>
    </DocPage>
  );
}
