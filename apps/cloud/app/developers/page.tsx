import { Metadata } from 'next';
import Link from 'next/link';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { GITHUB_REPO_URL } from '@/lib/github-links';
import { safeAuth } from '@/lib/safe-auth';
import '../landing.css';

export const metadata: Metadata = {
  title: 'Developers & Quickstart — Mastyf AI Agent Security Platform',
  description:
    'Protect your first AI agent in under 10 minutes. Drop in Mastyf Gateway, start in Audit Mode, define YAML execution policies, and enforce complete mediation with zero disruption.',
};

export default async function DevelopersPage() {
  const session = await safeAuth();

  const steps = [
    {
      num: '1',
      title: 'Install the Mastyf Gateway',
      code: 'npm install -g @mastyf_ai/server@4.1.12\nmastyf-ai --version',
    },
    {
      num: '2',
      title: 'Create a Policy',
      code: "# default-policy.yaml\nversion: '1.0'\npolicy:\n  mode: block # audit, warn or block\n  rules: []   # built-in guards still apply",
    },
    {
      num: '3',
      title: 'Route Your MCP Client through the Gateway',
      code: '// /path/to/mastyf/github.json: your real server, in the usual format\n{\n  "mcpServers": {\n    "github": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-github"]\n    }\n  }\n}\n\n// claude_desktop_config.json or .cursor/mcp.json: start it through the gateway\n{\n  "mcpServers": {\n    "github": {\n      "command": "mastyf-ai",\n      "args": [\n        "proxy",\n        "--config", "/path/to/mastyf/github.json",\n        "--policy", "/path/to/mastyf/default-policy.yaml"\n      ]\n    }\n  }\n}',
    },
    {
      num: '4',
      title: 'Test a Call Against Your Policy',
      code: `mastyf-ai policy test --policy ./default-policy.yaml --tool read_file --args '{"path":"/etc/passwd"}'\n# "action": "block", "reason": "Sensitive path blocked: /etc/passwd"`,
    },
  ];

  return (
    <div className="landing">
      <SiteNav session={!!session} />
      <main className="page-main">
        <div className="lp-section">
          <div className="lp-section-header">
            <span className="lp-pill lp-pill-gold">Developer Hub</span>
            <h1>Developer Quickstart &amp; Policy Integration</h1>
            <p>
              Get your first agent protected at the execution boundary in under 10 minutes.
            </p>
          </div>

          <div className="lp-quickstart-steps max-w-4xl mx-auto my-8 flex flex-col gap-6">
            {steps.map((st) => (
              <div key={st.num} className="card p-6">
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-8 h-8 rounded-full bg-amber-400/20 text-amber-400 font-bold flex items-center justify-center text-sm">
                    {st.num}
                  </span>
                  <h3 className="text-lg font-bold text-white m-0">{st.title}</h3>
                </div>
                <pre className="bg-slate-950/80 p-4 rounded-lg border border-slate-800 text-xs font-mono text-emerald-400 overflow-x-auto leading-relaxed">
                  <code>{st.code}</code>
                </pre>
              </div>
            ))}
          </div>

          <div className="card max-w-4xl mx-auto p-8 text-center mt-10">
            <h3 className="text-xl font-bold text-white mb-2">Explore the Open-Source Repository</h3>
            <p className="text-sm muted mb-6">
              Mastyf Gateway, the YAML policy engine, test fixtures, and documentation are all public on GitHub.
            </p>
            <div className="flex justify-center gap-4 flex-wrap">
              <a
                href={GITHUB_REPO_URL}
                className="btn btn-primary btn-pill"
                target="_blank"
                rel="noopener noreferrer"
              >
                View on GitHub (AGPL-3.0) →
              </a>
              <Link href="/pricing" className="btn btn-secondary btn-pill">
                Explore Enterprise Features &amp; Support
              </Link>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
