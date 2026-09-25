'use client';

import { useState } from 'react';

type ClientTab = 'claude' | 'cursor' | 'windsurf' | 'python' | 'docker';

interface ClientConfig {
  id: ClientTab;
  name: string;
  badge: string;
  filename: string;
  description: string;
  code: string;
  testCmd: string;
}

const CLIENT_CONFIGS: Record<ClientTab, ClientConfig> = {
  claude: {
    id: 'claude',
    name: 'Claude Desktop',
    badge: 'macOS / Windows',
    filename: '~/Library/Application Support/Claude/claude_desktop_config.json',
    description: 'Intercepts filesystem, web, and custom MCP tools for Claude Desktop via Mastyf Shield sidecar.',
    code: `{
  "mcpServers": {
    "mastyf-shield": {
      "command": "/Applications/Mastyf Shield.app/Contents/MacOS/mastyf",
      "args": ["proxy", "--target-client", "claude-desktop", "--fail-closed"],
      "env": {
        "MASTYF_LICENSE_KEY": "MSH1-YOUR-LICENSE-KEY",
        "MASTYF_POLICY_MODE": "enforce"
      }
    }
  }
}`,
    testCmd: 'mastyf test --client claude-desktop',
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor AI',
    badge: 'IDE Extension',
    filename: '.cursor/mcp.json',
    description: 'Enforces sub-microsecond capability mediation across all Cursor Composer and agent tool dispatches.',
    code: `{
  "mcpServers": {
    "mastyf-guard": {
      "command": "mastyf",
      "args": ["wrap", "--ide", "cursor", "--taint-tracking"],
      "env": {
        "MASTYF_ZERO_BYTE_DROP": "true",
        "MASTYF_MAX_LATENCY_US": "5.0"
      }
    }
  }
}`,
    testCmd: 'mastyf doctor --check-cursor',
  },
  windsurf: {
    id: 'windsurf',
    name: 'Windsurf',
    badge: 'Cascade Agent',
    filename: '~/.codeium/windsurf/mcp_config.json',
    description: 'Prevents indirect prompt injections and reverse shell execution during autonomous Cascade agent runs.',
    code: `{
  "mcpServers": {
    "mastyf-isolation": {
      "command": "mastyf-shield",
      "args": ["filter", "--protocol", "stdio", "--strict"],
      "env": {
        "MASTYF_ENFORCE_CBAC": "true"
      }
    }
  }
}`,
    testCmd: 'mastyf status --windsurf',
  },
  python: {
    id: 'python',
    name: 'Python / LangChain',
    badge: 'SDK Decorator',
    filename: 'agent_perimeter.py',
    description: 'Zero-latency Python wrapper for LangChain, LlamaIndex, and custom agent tool loops.',
    code: `from mastyf import MastyfGuard, ToolDispatch

# Initialize fail-closed execution monitor (<4.8µs latency)
guard = MastyfGuard(perimeter="production-agent-mesh")

@guard.enforce(
    invariants=["sandbox_root_boundary", "untrusted_egress_sink"],
    difc_taint_tracking=True,
    fail_closed=True
)
def dispatch_agent_tool(request: ToolDispatch):
    """Synchronously verified before socket execution."""
    return guard.authorize_and_dispatch(request)`,
    testCmd: 'python -m mastyf.verify',
  },
  docker: {
    id: 'docker',
    name: 'Docker / K8s',
    badge: 'Production Sidecar',
    filename: 'docker-compose.yml',
    description: 'Deploy Mastyf Gateway as an inline container sidecar proxy across your Kubernetes or ECS cluster.',
    code: `services:
  agent-runner:
    image: my-enterprise-agent:latest
    environment:
      - HTTP_PROXY=http://mastyf-gateway:8443
    depends_on:
      - mastyf-gateway

  mastyf-gateway:
    image: ghcr.io/mastyf-ai/mastyf-gateway:latest
    ports:
      - "8443:8443"
    environment:
      - MASTYF_MODE=enforce
      - MASTYF_FAIL_CLOSED=true`,
    testCmd: 'docker compose exec mastyf-gateway mastyf health',
  },
};

export function ArcadeSetupShowcase() {
  const [activeTab, setActiveTab] = useState<ClientTab>('claude');
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedTest, setCopiedTest] = useState(false);

  const client = CLIENT_CONFIGS[activeTab];

  const handleCopyCode = () => {
    navigator.clipboard?.writeText(client.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyTest = () => {
    navigator.clipboard?.writeText(client.testCmd);
    setCopiedTest(true);
    setTimeout(() => setCopiedTest(false), 2000);
  };

  return (
    <section className="lp-section lp-arcade-setup-section" id="developers" aria-label="Developer Quickstart">
      <div className="lp-section-header">
        <span className="lp-pill lp-pill-gold">10-Second Developer Quickstart</span>
        <h2 className="lp-editorial-heading">Set up your Security Perimeter in Seconds</h2>
        <p>Zero code changes to your AI model. Select your client below to generate ready-to-paste integration configs.</p>
      </div>

      {/* Client Selector Pills */}
      <div className="flex items-center justify-center gap-2 mb-6 flex-wrap">
        {(Object.keys(CLIENT_CONFIGS) as ClientTab[]).map((tabKey) => {
          const tab = CLIENT_CONFIGS[tabKey];
          const isActive = activeTab === tabKey;
          return (
            <button
              key={tabKey}
              type="button"
              onClick={() => setActiveTab(tabKey)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 border ${
                isActive
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 shadow-md shadow-amber-500/10'
                  : 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:border-white/20'
              }`}
            >
              <span>{tab.name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${isActive ? 'bg-amber-400/20 text-amber-200' : 'bg-white/5 text-slate-500'}`}>
                {tab.badge}
              </span>
            </button>
          );
        })}
      </div>

      {/* Main Configuration Card */}
      <div className="card lp-arcade-code-card max-w-4xl mx-auto shadow-2xl border-white/15">
        <div className="lp-arcade-code-header flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="lp-dot lp-dot-red" />
              <span className="lp-dot lp-dot-yellow" />
              <span className="lp-dot lp-dot-green" />
            </div>
            <span className="text-xs font-mono text-slate-400 truncate max-w-xs sm:max-w-md">
              {client.filename}
            </span>
          </div>
          <button
            type="button"
            onClick={handleCopyCode}
            className="text-xs font-mono text-amber-400 hover:text-amber-300 px-3 py-1 bg-amber-500/10 rounded-lg border border-amber-500/30 font-semibold transition-colors flex items-center gap-1.5"
          >
            {copiedCode ? '✓ Copied Config' : 'Copy Config'}
          </button>
        </div>

        <div className="lp-arcade-code-body font-mono text-xs leading-relaxed p-6 bg-[#080b12]">
          <pre className="text-slate-300 overflow-x-auto m-0">
            <code>{client.code}</code>
          </pre>
        </div>

        {/* Verification Command Bar */}
        <div className="p-3.5 bg-black/60 border-t border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-emerald-400 font-bold">⚡ Test Connectivity:</span>
            <code className="text-slate-300 font-mono bg-white/5 px-2 py-1 rounded border border-white/5">
              {client.testCmd}
            </code>
          </div>
          <button
            type="button"
            onClick={handleCopyTest}
            className="text-[11px] font-mono text-slate-400 hover:text-white px-2.5 py-1 rounded bg-white/5 border border-white/10 shrink-0"
          >
            {copiedTest ? '✓ Copied Command' : 'Copy Test'}
          </button>
        </div>
      </div>
    </section>
  );
}
