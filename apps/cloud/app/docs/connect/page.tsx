import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Download } from 'lucide-react';
import { DocCode } from '@/components/docs/DocCode';
import { DocPage, DocSection } from '@/components/docs/DocPage';

export const metadata: Metadata = {
  title: 'Connect your agent — Mastyf docs',
  description:
    'Put Mastyf between your agent and its tools: Claude Desktop, Cursor, Windsurf, Cline, the OpenAI Agents SDK, LangChain, or your own code calling the Claude or OpenAI API.',
};

const INSTALL = `npm install -g @mastyf_ai/server@4.1.12
mastyf-ai start --policy ./default-policy.yaml`;

const WRAP_PREVIEW = `# See what would change (writes per-server configs, leaves the app's config alone)
mastyf-ai wrap --client claude-desktop --policy "$PWD/default-policy.yaml"`;

const WRAP_APPLY = `# Apply it (backs up the app's config first)
mastyf-ai wrap --client claude-desktop --policy "$PWD/default-policy.yaml" --apply`;

const WRAP_BEFORE = `"filesystem": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/projects"]
}`;

const WRAP_AFTER = `"filesystem": {
  "command": "<mastyf proxy wrapper>",
  "args": ["--config", "mastyf-ai-configs/filesystem.json", "--policy", "/path/to/default-policy.yaml"]
}`;

const OPENAI_INSTALL = 'npm install @mastyf_ai/openai-agents-middleware';

const OPENAI_WRAP_TOOLS = `import { Agent, tool } from '@openai/agents';
import { z } from 'zod';
import { wrapToolsWithMastyfGuard } from '@mastyf_ai/openai-agents-middleware';

// Wrap the tool definitions, then build the tools from them.
const definitions = wrapToolsWithMastyfGuard(
  [
    {
      name: 'read_file',
      description: 'Read a file from the project',
      parameters: z.object({ path: z.string() }),
      execute: async ({ path }) => readFile(path, 'utf8'),
    },
  ],
  {
    proxyUrl: 'http://localhost:4000',
    apiKey: process.env.MASTYF_GATEWAY_KEY, // the gateway's DASHBOARD_API_KEY, if you set one
  },
);

const agent = new Agent({ name: 'assistant', tools: definitions.map((d) => tool(d)) });
// A denied call throws "Mastyf blocked …" inside the tool instead of running it.`;

const GUARD_HELPER = `/** Run fn only if Mastyf passes the call. Anything else, including errors, blocks it. */
export function guarded<A extends Record<string, unknown>, R>(name: string, fn: (args: A) => Promise<R>) {
  return async (args: A): Promise<R> => {
    let verdict: { action?: string; reason?: string } = {};
    try {
      const res = await fetch('http://localhost:4000/api/policy/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: name, server: 'langchain-agent', arguments: args }),
        signal: AbortSignal.timeout(10_000),
      });
      verdict = res.ok ? await res.json() : { reason: \`HTTP \${res.status}\` };
    } catch (err) {
      verdict = { reason: \`Mastyf unreachable: \${err}\` };
    }
    if (verdict.action !== 'pass') throw new Error(\`Blocked by Mastyf: \${verdict.reason ?? 'denied'}\`);
    return fn(args);
  };
}`;

const LANGCHAIN_TOOL = `import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { guarded } from './guarded';

const readProjectFile = tool(
  guarded('read_file', async ({ path }: { path: string }) => readFile(path, 'utf8')),
  {
    name: 'read_file',
    description: 'Read a file from the project',
    schema: z.object({ path: z.string() }),
  },
);

// Give readProjectFile to your agent like any other tool.`;

const CHECK_REQUEST = `POST http://localhost:4000/api/policy/test
Authorization: Bearer <DASHBOARD_API_KEY>   (only if the gateway has one)
Content-Type: application/json

{ "tool": "delete_file", "server": "my-agent", "arguments": { "path": "/etc/passwd" } }

→ { "action": "block", "rule": "...", "reason": "...", "mode": "block" }`;

const CLAUDE_LOOP = `import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

/** Ask Mastyf before running a tool. Anything but a clear "pass" is a no. */
async function mastyfAllows(tool: string, args: unknown) {
  try {
    const res = await fetch('http://localhost:4000/api/policy/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, server: 'my-agent', arguments: args }),
      signal: AbortSignal.timeout(10_000),
    });
    const verdict = await res.json();
    return res.ok && verdict.action === 'pass'
      ? { allowed: true }
      : { allowed: false, reason: verdict.reason ?? \`HTTP \${res.status}\` };
  } catch (err) {
    return { allowed: false, reason: \`Mastyf unreachable: \${err}\` }; // fail closed
  }
}

const message = await anthropic.messages.create({ model, max_tokens: 1024, tools, messages });

const results = [];
for (const block of message.content) {
  if (block.type !== 'tool_use') continue;
  const verdict = await mastyfAllows(block.name, block.input);
  results.push({
    type: 'tool_result',
    tool_use_id: block.id,
    is_error: !verdict.allowed,
    content: verdict.allowed
      ? await runTool(block.name, block.input)
      : \`Blocked by Mastyf: \${verdict.reason}\`,
  });
}
// Send results back to Claude as the next user message.`;

const OPENAI_LOOP = `import json, requests
from openai import OpenAI

client = OpenAI()

def mastyf_allows(tool, args):
    """Ask Mastyf before running a tool. Anything but a clear "pass" is a no."""
    try:
        r = requests.post(
            "http://localhost:4000/api/policy/test",
            json={"tool": tool, "server": "my-agent", "arguments": args},
            timeout=10,
        )
        verdict = r.json()
        if r.ok and verdict.get("action") == "pass":
            return True, ""
        return False, verdict.get("reason", f"HTTP {r.status_code}")
    except Exception as err:
        return False, f"Mastyf unreachable: {err}"  # fail closed

response = client.chat.completions.create(model=model, messages=messages, tools=tools)

for call in response.choices[0].message.tool_calls or []:
    args = json.loads(call.function.arguments)
    allowed, reason = mastyf_allows(call.function.name, args)
    content = run_tool(call.function.name, args) if allowed else f"Blocked by Mastyf: {reason}"
    messages.append({"role": "tool", "tool_call_id": call.id, "content": content})`;

const CLOUD_ENV = `MASTYF_AI_CONTROL_PLANE_URL=https://www.mastyf.ai
MASTYF_AI_MULTI_TENANT_ENABLED=true
MASTYF_AI_TENANT_ID=<your workspace ID>
MASTYF_AI_CLOUD_API_KEY=<API key from Settings → API key>
DASHBOARD_JWT_SECRET=<random, this host only: openssl rand -base64 32>`;

function OptionsTable({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="table-scroll doc-block">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Option</th>
            <th scope="col">Default</th>
            <th scope="col">What it does</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([option, def, meaning]) => (
            <tr key={option}>
              <td>
                <code>{option}</code>
              </td>
              <td>
                <code>{def}</code>
              </td>
              <td>{meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SHARED_OPTIONS: [string, string, string][] = [
  ['proxyUrl', '—', 'Where the gateway listens, usually http://localhost:4000.'],
  ['mode', "'block'", 'block: run only what the policy allows. warn: log denials and run anyway. audit: don’t check.'],
  ['failOpen', 'false', 'Run the tool when the gateway can’t answer. By default the call is blocked.'],
  ['apiKey', '—', 'The gateway’s DASHBOARD_API_KEY, sent as a Bearer token, if you set one.'],
  ['timeoutMs', '10000', 'How long to wait for the gateway.'],
  ['identityContext', '—', 'userId and clientId of the person or app behind the call, for the audit log.'],
];

export default function ConnectYourAgentPage() {
  return (
    <DocPage
      slug="connect"
      lead="Mastyf sits between your agent and the tools it uses. Pick how your agent gets its tools and follow that section; the rest of the page doesn’t apply to you."
    >
      <DocSection id="how-it-connects" title="How it connects">
        <p>
          Mastyf doesn&rsquo;t sit next to the AI model. It sits between the agent and its tools. Whether the agent runs
          on Claude, GPT or a local model, every time it tries to <em>do</em> something (read a file, query a database,
          call an API), that call goes through the Mastyf gateway first. The gateway checks it against your policy, then
          either passes it to the tool or blocks it before the tool runs.
        </p>
        <dl className="doc-list">
          <div>
            <dt>1. Your agent</dt>
            <dd>Any model and any framework. It asks to call a tool with some arguments.</dd>
          </div>
          <div>
            <dt>2. Mastyf gateway</dt>
            <dd>
              Checks the call: patterns, schema and your policy, then an optional AI review for borderline cases. Every
              decision is logged.
            </dd>
          </div>
          <div>
            <dt>3. Your tools</dt>
            <dd>MCP servers, APIs, databases, files. They only see calls the gateway allowed.</dd>
          </div>
        </dl>
      </DocSection>

      <DocSection id="supported-clients" title="Supported clients">
        <p>Find your agent below; the link takes you to its section.</p>
        <div className="table-scroll doc-block">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Your agent</th>
                <th scope="col">How it connects</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Claude Desktop, Cursor, Windsurf, Cline</td>
                <td>
                  <a href="#desktop-apps">Wrap its MCP servers</a> with the CLI, or let the{' '}
                  <a href="#shield">Shield app</a> do it
                </td>
              </tr>
              <tr>
                <td>An agent built with the OpenAI Agents SDK</td>
                <td>
                  <a href="#openai-agents">Wrap its tool definitions</a>
                </td>
              </tr>
              <tr>
                <td>A LangChain agent</td>
                <td>
                  <a href="#langchain">Guard each tool&rsquo;s function</a>
                </td>
              </tr>
              <tr>
                <td>Your own code calling the Claude or OpenAI API</td>
                <td>
                  <a href="#custom-agent">One HTTP check</a> before each tool runs
                </td>
              </tr>
              <tr>
                <td>Any other MCP client</td>
                <td>
                  Point it at the gateway instead of the MCP server; the gateway speaks stdio, HTTP, SSE, streamable HTTP
                  and WebSocket
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </DocSection>

      <DocSection id="install" title="Install the gateway">
        <p>
          Every method except the Shield app needs the gateway running. It needs Node.js 18 or newer. Start it with your
          policy file; it listens on <code>http://localhost:4000</code>, where its local dashboard also runs.
        </p>
        <DocCode code={INSTALL} label="Install and start the gateway" />
        <p className="doc-note">
          Starting templates ship in the package&rsquo;s <code>policy-templates/</code> folder. Add{' '}
          <code>--blocking-mode audit</code> to record decisions without blocking while you tune the policy; the
          default is <code>block</code>.
        </p>
      </DocSection>

      <DocSection id="desktop-apps" title="Claude Desktop, Cursor, Windsurf, Cline">
        <p>
          These apps get their tools from MCP servers listed in a config file. <code>mastyf-ai wrap</code> rewrites that
          file so each server is started through the gateway, which then starts the real server.
        </p>
        <DocCode code={WRAP_PREVIEW} label="Preview the wrap" />
        <DocCode code={WRAP_APPLY} label="Apply the wrap" />
        <p className="doc-note">
          On Windows, <code>wrap</code> doesn&rsquo;t work in this version because a script it needs is missing from the
          package. Use the manual setup in the <Link href="/developers">developer quickstart</Link> instead, and start
          each server with <code>node</code> and its script path, because the gateway crashes on <code>npx</code> there.
        </p>
        <p>
          Use <code>--client cursor</code>, <code>windsurf</code>, <code>cline</code> or <code>auto</code> for the other
          apps, then <strong>restart the app</strong>. Each server entry changes like this:
        </p>
        <div className="doc-columns">
          <div>
            <h3>Before</h3>
            <DocCode code={WRAP_BEFORE} label="Server entry before wrapping" />
          </div>
          <div>
            <h3>After</h3>
            <DocCode code={WRAP_AFTER} label="Server entry after wrapping" />
          </div>
        </div>
        <div className="table-scroll doc-block">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">App</th>
                <th scope="col">Config file it changes</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Claude Desktop (macOS)</td>
                <td>
                  <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>
                </td>
              </tr>
              <tr>
                <td>Claude Desktop (Windows)</td>
                <td>
                  <code>%APPDATA%\Claude\claude_desktop_config.json</code>
                </td>
              </tr>
              <tr>
                <td>Claude Desktop (Linux)</td>
                <td>
                  <code>~/.config/Claude/claude_desktop_config.json</code>
                </td>
              </tr>
              <tr>
                <td>Cursor</td>
                <td>
                  <code>~/.cursor/mcp.json</code>
                </td>
              </tr>
              <tr>
                <td>Windsurf</td>
                <td>
                  <code>~/.windsurf/mcp.json</code>
                </td>
              </tr>
              <tr>
                <td>Cline</td>
                <td>
                  <code>~/.config/cline/mcp_config.json</code>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="doc-note">
          To undo, restore the timestamped <code>.bak</code> copy that <code>--apply</code> saved next to the config
          file, then restart the app.
        </p>
      </DocSection>

      <DocSection id="shield" title="Shield desktop app">
        <p>
          The no-terminal option. Shield finds Claude Desktop, Cursor and Windsurf on your machine and routes their MCP
          servers through itself. Decisions run locally, with no cloud round trip. Activate it with the license key from
          your dashboard.
        </p>
        <div className="btn-row">
          <Link href="/download" className="btn btn-primary btn-sm">
            <Download size={13} strokeWidth={2} aria-hidden="true" />
            Download Shield
          </Link>
          <Link href="/docs/shield" className="link-icon">
            How Shield works
            <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </div>
      </DocSection>

      <DocSection id="openai-agents" title="OpenAI Agents SDK">
        <p>
          With the gateway running, wrap your tool definitions before you turn them into tools. Each tool then asks the
          gateway before it runs, and only runs on a pass.
        </p>
        <DocCode code={OPENAI_INSTALL} label="Install the OpenAI Agents middleware" />
        <DocCode code={OPENAI_WRAP_TOOLS} label="Wrap OpenAI Agents tool definitions" />
        <OptionsTable
          rows={[
            ...SHARED_OPTIONS,
            ['blockedTools', '[]', 'Tool names that are always denied, without asking the gateway.'],
          ]}
        />
      </DocSection>

      <DocSection id="langchain" title="LangChain">
        <p>
          Guard each tool&rsquo;s function with a small helper that asks the gateway first, then build the tool with
          LangChain&rsquo;s <code>tool()</code> as usual. Save the helper once and reuse it for every tool:
        </p>
        <DocCode code={GUARD_HELPER} label="guarded.ts" />
        <DocCode code={LANGCHAIN_TOOL} label="A guarded LangChain tool" />
        <p className="doc-note">
          A blocked call throws, and LangChain reports the error back to the model as the tool&rsquo;s result, so the
          agent can try something else. The same helper works for any framework whose tools are async functions.
        </p>
      </DocSection>

      <DocSection id="custom-agent" title="Your own agent">
        <p>
          If you wrote the tool-calling loop yourself against the Claude or OpenAI API, ask the gateway before you run
          each tool the model requests. Run the tool only when the answer is <code>pass</code>, and tell the model when a
          call was blocked so it can choose another approach.
        </p>
        <DocCode code={CHECK_REQUEST} label="The check request and response" />
        <h3>Claude (TypeScript)</h3>
        <DocCode code={CLAUDE_LOOP} label="Claude tool loop with a Mastyf check" />
        <h3>OpenAI (Python)</h3>
        <DocCode code={OPENAI_LOOP} label="OpenAI tool loop with a Mastyf check" />
        <p className="doc-note">
          Send the tool&rsquo;s arguments as <code>arguments</code>. Argument rules (paths, shell commands, injected
          text, secrets) only fire when the gateway can see them.
        </p>
      </DocSection>

      <DocSection id="cloud" title="Link to Mastyf Cloud">
        <p>
          Linking a gateway to your workspace syncs its policy from the dashboard, reports its decisions to Fleet, and
          lets you open its local dashboard from the cloud. Create an API key under <strong>Settings → API key</strong>,
          then set these on the gateway host. The{' '}
          <Link href="/dashboard/connect">Link a proxy</Link> page fills in your workspace ID.
        </p>
        <DocCode code={CLOUD_ENV} label="Environment for a linked gateway" />
        <p className="notice notice--warn">
          The gateway only ever needs your workspace&rsquo;s API key. Never put Mastyf Cloud&rsquo;s own secrets
          (<code>AUTH_SECRET</code>, <code>LICENSE_JWT_SECRET</code>) on a gateway host.
        </p>
      </DocSection>

      <DocSection id="failure" title="If the proxy is down">
        <p>Mastyf is a security control, so when it can&rsquo;t decide, the default is to block.</p>
        <ul className="doc-bullets">
          <li>
            <strong>OpenAI Agents SDK</strong>: the wrapped tools don&rsquo;t run when the gateway is unreachable, errors,
            times out or gives an unexpected answer. Set <code>failOpen: true</code> to let calls through instead, or{' '}
            <code>mode: &apos;warn&apos;</code> to log denials without blocking.
          </li>
          <li>
            <strong>LangChain</strong> and other frameworks using the <code>guarded</code> helper: anything but a{' '}
            <code>pass</code>, including a network error, blocks the call.
          </li>
          <li>
            <strong>Wrapped desktop apps</strong> reach their MCP servers through the gateway, so if it stops, those
            tools stop with it until it&rsquo;s running again.
          </li>
          <li>
            <strong>Your own agent</strong>: treat a network error or a non-<code>pass</code> answer as a block, as the
            examples above do.
          </li>
        </ul>
      </DocSection>
    </DocPage>
  );
}
