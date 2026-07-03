'use client';

import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { useAgenticActions, AgenticInlineResult } from './AgenticActionContext';

const TOOL_GROUPS = [
  {
    title: 'Policy & security',
    tools: [
      { id: 'policy-gen', label: 'Generate policy', path: '/api/agentic/policy-gen/generate' },
      { id: 'policy-start', label: 'Start observation', path: '/api/agentic/policy-gen/start-observation' },
      { id: 'policy-stop', label: 'Stop observation', path: '/api/agentic/policy-gen/stop-observation' },
      { id: 'injection-scan', label: 'Run injection scan', path: '/api/agentic/prompt-injection/scan' },
      { id: 'dlp-scan', label: 'Run response DLP', path: '/api/agentic/dlp/scan' },
    ],
  },
  {
    title: 'Defense & ops',
    tools: [
      { id: 'decoy', label: 'Deploy decoy', path: '/api/agentic/honeypot/deploy' },
      { id: 'fuzzer', label: 'Run protocol fuzzer', path: '/api/agentic/fuzzer/run' },
      { id: 'playbook', label: 'Run incident playbook', path: '/api/agentic/playbook/run', body: { trigger: 'dashboard', playbook: 'prompt_injection', severity: 'high' } },
      { id: 'harden', label: 'Config hardening', path: '/api/agentic/harden/analyze', body: { serverName: 'filesystem' } },
    ],
  },
  {
    title: 'Research (lab)',
    tools: [
      { id: 'red-team', label: 'Run red team', path: '/api/agentic/red-team/run' },
      { id: 'collusion', label: 'Collusion scan', path: '/api/agentic/collusion/detect' },
      { id: 'thompson', label: 'Evaluate agent trust', path: '/api/agentic/rl/thompson' },
      { id: 'certify', label: 'Certify server', path: '/api/agentic/certification/certify', body: { serverName: 'filesystem', packageName: '@modelcontextprotocol/server-filesystem', version: 'latest', trustScore: 70, complianceScore: 50, cveFree: true, authMethod: 'none', transport: 'stdio', trustedPublisher: true } },
    ],
  },
];

export function AgenticToolsPanel() {
  const { runAction, busy } = useAgenticActions();

  return (
    <div className="agentic-panel space-y-6">
      <div>
        <h2 className="text-xl font-bold">Admin tools</h2>
        <p className="text-sm text-gray-500">
          Run agentic actions on demand. Results appear inline below each button (not in a sidebar).
          Actions use backend-provided defaults and return unavailable states when required context is missing.
        </p>
      </div>
      {TOOL_GROUPS.map((group) => (
        <div key={group.title}>
          <h3 className="font-semibold text-sm text-gray-600 mb-2">{group.title}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {group.tools.map((t) => (
              <Card key={t.id} className="p-3 space-y-2">
                <Button
                  size="sm"
                  variant="primary"
                  className="w-full"
                  disabled={!!busy}
                  onClick={() => void runAction(t.id, t.label, t.path, t.body)}
                >
                  {busy === t.id ? 'Running…' : t.label}
                </Button>
                <AgenticInlineResult actionId={t.id} />
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
