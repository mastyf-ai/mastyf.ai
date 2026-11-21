import type { Metadata } from 'next';
import Link from 'next/link';
import { DocCode } from '@/components/docs/DocCode';
import { DocPage, DocSection } from '@/components/docs/DocPage';
import { DocFlow, DocTable } from '@/components/docs/DocVisuals';

export const metadata: Metadata = {
  title: 'Check program and API — Mastyf docs',
  description:
    'The free Mastyf check engine as one program: a local HTTP API any agent can ask before running a tool, a proxy for stdio MCP servers, and a one-off test command.',
};

const RELEASE = 'https://github.com/mastyf-ai/mastyf.ai/releases/tag/check-v0.1.0';

const DOWNLOAD_UNIX = `# Linux x64 shown; pick your file from the table above
curl -LO https://github.com/mastyf-ai/mastyf.ai/releases/download/check-v0.1.0/mastyf-check-linux-x64
curl -LO https://github.com/mastyf-ai/mastyf.ai/releases/download/check-v0.1.0/mastyf-check-linux-x64.sha256
sha256sum -c mastyf-check-linux-x64.sha256
chmod +x mastyf-check-linux-x64 && mv mastyf-check-linux-x64 /usr/local/bin/mastyf-check`;

const DOWNLOAD_WIN = `# Windows (PowerShell): compare the two hashes before you run it
Get-FileHash .\\mastyf-check-win-x64.exe -Algorithm SHA256
Get-Content .\\mastyf-check-win-x64.exe.sha256`;

const SERVE = `mastyf-check serve
# listening on http://127.0.0.1:4100
# token: ~/.mastyf/check/token   (Windows: %APPDATA%\\Mastyf\\check\\token)`;

const PROXY = `mastyf-check proxy -- npx -y @modelcontextprotocol/server-filesystem ./project`;

const MCP_CONFIG = `{
  "mcpServers": {
    "filesystem": {
      "command": "mastyf-check",
      "args": ["proxy", "--", "npx", "-y", "@modelcontextprotocol/server-filesystem", "./project"]
    }
  }
}`;

const CALL = `POST /v1/check/call
Authorization: Bearer <token>
Content-Type: application/json

{
  "tool": "read_file",
  "arguments": { "path": "/etc/passwd" },
  "server": "filesystem",     // optional: which tool server
  "agent": "billing-bot",     // optional: which agent
  "session": "request-8f2c"   // optional: one per user request
}`;

const CALL_ANSWER = `{
  "decision": "block",
  "id": "72e48071-b392-4e3c-8e77-45751c985ec0",
  "layer": "policy",
  "rule": "semantic-path-guard",
  "reason": "Sensitive path blocked: /etc/passwd"
}

// an allowed call
{ "decision": "allow", "id": "428f9517-8823-4a73-8c36-1ac8151752b1" }`;

const RESULT = `POST /v1/check/result
Authorization: Bearer <token>

{
  "tool": "fetch_page",
  "result": { "text": "…the page your tool fetched…" },
  "arguments": { "url": "https://example.com" },   // optional
  "session": "request-8f2c"                         // optional
}`;

const TOOLS = `POST /v1/tools
Authorization: Bearer <token>

{ "server": "filesystem", "tools": [{ "name": "read_file", "description": "…", "inputSchema": {} }] }`;

const LOOP = `import json, os, pathlib, requests

URL = os.environ.get("MASTYF_CHECK_URL", "http://127.0.0.1:4100")
TOKEN = os.environ.get("MASTYF_CHECK_TOKEN") or (pathlib.Path.home() / ".mastyf/check/token").read_text().strip()
AUTH = {"Authorization": f"Bearer {TOKEN}"}

def ask(path, body):
    """Anything but a clear answer is a block."""
    try:
        r = requests.post(URL + path, json=body, headers=AUTH, timeout=10)
        return r.json() if r.ok else {"decision": "block", "reason": f"HTTP {r.status_code}"}
    except requests.RequestException as err:
        return {"decision": "block", "reason": f"no check: {err}"}

def run_tool_checked(name, args, session):
    before = ask("/v1/check/call", {"tool": name, "arguments": args, "session": session})
    if before["decision"] != "allow":
        return f"Blocked by Mastyf ({before.get('layer')}: {before.get('rule')})."
    result = run_tool(name, args)                      # your own tool
    after = ask("/v1/check/result", {"tool": name, "result": result, "arguments": args, "session": session})
    if after["decision"] == "block":
        return f"Blocked by Mastyf ({after.get('layer')}: {after.get('rule')})."
    return after["result"] if after["decision"] == "redact" else result`;

export default function CheckDocsPage() {
  return (
    <DocPage slug="check">
      <DocSection id="download" title="Download">
        <p>
          One file, no install. The Python library downloads it for you; download it yourself to use it from any other
          language, in front of an MCP server, or in CI.
        </p>
        <DocTable
          head={['System', 'File']}
          rows={[
            ['Windows x64', <code key="w">mastyf-check-win-x64.exe</code>],
            ['macOS, Apple silicon', <code key="ma">mastyf-check-darwin-arm64</code>],
            ['macOS, Intel', <code key="mi">mastyf-check-darwin-x64</code>],
            ['Linux x64', <code key="lx">mastyf-check-linux-x64</code>],
            ['Linux arm64', <code key="la">mastyf-check-linux-arm64</code>],
          ]}
        />
        <p>
          Every file has a <code>.sha256</code> next to it on the{' '}
          <a href={RELEASE} target="_blank" rel="noopener noreferrer">
            check-v0.1.0 release
          </a>
          . Check it before you run the program.
        </p>
        <DocCode code={DOWNLOAD_UNIX} label="Download and verify on Linux or macOS" />
        <DocCode code={DOWNLOAD_WIN} label="Verify on Windows" />
      </DocSection>

      <DocSection id="commands" title="Commands">
        <DocTable
          head={['Command', 'What it does']}
          rows={[
            [<code key="s">mastyf-check serve</code>, 'Start the check API on this machine.'],
            [<code key="p">mastyf-check proxy -- &lt;command&gt;</code>, 'Put the checks in front of one stdio MCP server.'],
            [<code key="t">mastyf-check test &lt;tool&gt; &apos;&lt;json&gt;&apos;</code>, 'Check one call and print the verdict. Exit code 2 when blocked.'],
            [<code key="i">mastyf-check init-copilot</code>, <>Write hooks for GitHub Copilot&rsquo;s coding agent into a repository. Needs the repository build; see <Link href="/docs/copilot">GitHub Copilot</Link>.</>],
          ]}
        />
        <DocCode code={SERVE} label="Start the check API" />
        <DocTable
          head={['Option for serve', 'Default', 'What it does']}
          rows={[
            [<code key="p">--port</code>, '4100', <>Port. Also <code>MASTYF_CHECK_PORT</code>.</>],
            [<code key="h">--host</code>, '127.0.0.1', <>Address. Any other address needs <code>MASTYF_CHECK_TOKEN</code> set, 32 characters or more.</>],
            [<code key="po">--policy</code>, 'built-in rules', <>Your own rules file. See <Link href="/docs/rules">Rules</Link>.</>],
            [<code key="m">--mode</code>, 'block', <><code>observe</code> allows everything and marks what would have been blocked.</>],
            [<code key="l">--log</code>, 'json', 'One line per decision, as json or text. Never argument values, results, matched text or the token.'],
            [<code key="mb">--max-body</code>, '2', 'Largest request accepted, in whole MB from 1 to 64.'],
          ]}
        />
      </DocSection>

      <DocSection id="mcp" title="In front of an MCP server">
        <DocFlow
          label="An MCP server behind the checks"
          steps={[
            { label: 'MCP client', sub: 'Claude Desktop, an IDE, your agent' },
            { label: 'mastyf-check proxy', sub: 'checks calls, results and tool lists', tone: 'check' },
            { label: 'MCP server', sub: 'started by the proxy', tone: 'ok' },
          ]}
        />
        <DocCode code={PROXY} label="Run an MCP server through the checks" />
        <p>In an MCP client&rsquo;s settings, put the proxy where the server&rsquo;s command was:</p>
        <DocCode code={MCP_CONFIG} label="An MCP server entry routed through the checks" />
        <p className="doc-note">
          The proxy also remembers each server&rsquo;s tool list. A server that changes a tool&rsquo;s name, description
          or schema after it was first seen is blocked from then on.
        </p>
      </DocSection>

      <DocSection id="api" title="HTTP API">
        <p>
          Every request except <code>GET /v1/health</code> needs the token as <code>Authorization: Bearer &lt;token&gt;</code>
          . Bodies are JSON objects, at most 64 levels deep and 2 MB unless you raise <code>--max-body</code>.
        </p>
        <DocTable
          head={['Request', 'Use it']}
          rows={[
            [<code key="c">POST /v1/check/call</code>, 'Before a tool runs.'],
            [<code key="r">POST /v1/check/result</code>, 'Before a tool’s result goes back to the model.'],
            [<code key="t">POST /v1/tools</code>, 'When a tool server tells you what tools it has. Catches changed or poisoned tool definitions.'],
            [<code key="b">GET /v1/blocks?limit=50</code>, 'The latest blocks (up to 200 kept) and running totals.'],
            [<code key="h">GET /v1/health</code>, <>Readiness, version and rule count. Add <code>?nonce=…</code> to get proof the service holds your token without sending it.</>],
          ]}
        />
        <h3>Check a call</h3>
        <DocCode code={CALL} label="POST /v1/check/call" />
        <DocCode code={CALL_ANSWER} label="A blocked call" />
        <h3>Check a result</h3>
        <DocCode code={RESULT} label="POST /v1/check/result" />
        <p>
          A blocked result never names the words it matched, because they were written by whoever controls the tool. Add{' '}
          <code>&quot;includeMatch&quot;: true</code> only if you will not show them to the model.
        </p>
        <h3>Register a tool list</h3>
        <DocCode code={TOOLS} label="POST /v1/tools" />
      </DocSection>

      <DocSection id="verdict" title="The verdict">
        <DocTable
          head={['decision', 'What to do']}
          rows={[
            [<code key="a">allow</code>, 'Run the tool, or pass the result on.'],
            [<code key="b">block</code>, 'Don’t run it, or don’t pass it on. Tell the model it was blocked.'],
            [<code key="r">redact</code>, <>Results only: pass on <code>result</code> from the verdict, which has the secret replaced.</>],
          ]}
        />
        <DocTable
          head={['Status', 'Meaning']}
          rows={[
            ['200', 'A verdict.'],
            ['400', 'The request is malformed; the reason is in error.'],
            ['401', 'Missing or wrong token.'],
            ['413', 'The body is too large.'],
            ['500', 'The check itself failed. Treat the call as not checked, which by default means blocked.'],
          ]}
        />
      </DocSection>

      <DocSection id="example" title="A tool loop, end to end">
        <p>
          A complete Python example with no Mastyf library, the shape any language follows. Anything other than a clear
          answer counts as a block.
        </p>
        <DocCode code={LOOP} label="Checking a tool call and its result over HTTP" />
      </DocSection>
    </DocPage>
  );
}
