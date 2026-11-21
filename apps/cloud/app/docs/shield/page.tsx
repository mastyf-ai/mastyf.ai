import type { Metadata } from 'next';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { DocCode } from '@/components/docs/DocCode';
import { DocPage, DocSection } from '@/components/docs/DocPage';
import { DocFlow, DocTable } from '@/components/docs/DocVisuals';

export const metadata: Metadata = {
  title: 'Shield app — Mastyf docs',
  description:
    'Install and activate Mastyf Shield on Windows, connect Claude Code, Cursor, VS Code and other agents, check it works, and see what it records.',
};

const HASH = `Get-FileHash "Mastyf Shield Setup <version>.exe" -Algorithm SHA256`;

const PROMPT = `Mastyf Shield is installed on this Windows PC. Connect yourself to it so every MCP server you use is routed through Shield's proxy. Work carefully and show me your plan before changing anything.

1. Find your own MCP server settings (the file or files where your MCP servers are defined) and list each server by name and type (command-based or URL-based). Never print the values of env vars, headers, tokens or keys.

2. If you are Claude Code, Cursor, VS Code (Copilot), Windsurf, Cline or Claude Desktop, stop here and tell me: "Open Mastyf Shield → Account → Protection and turn on 'Route MCP servers through Shield', then restart me." Shield does this itself and can undo it.

3. Otherwise, check these exist and tell me if any is missing:
   - %LOCALAPPDATA%\\Programs\\Mastyf Shield\\resources\\stack\\node\\node.exe
   - %LOCALAPPDATA%\\Programs\\Mastyf Shield\\resources\\stack\\bff\\proxy-launcher.cjs
   - %LOCALAPPDATA%\\Programs\\Mastyf Shield\\resources\\stack\\bff\\dist\\cli.js
   - %APPDATA%\\Mastyf Shield\\policy\\active-policy.yaml
   - %APPDATA%\\Mastyf Shield\\license.json (may be missing on the free plan; that's fine)

4. Back up your settings file next to it with a timestamp in the name.

5. For each server not already routed (one already routed has "proxy-launcher.cjs" in its args, or a "_mastyf" field):
   a. Write its original definition to %APPDATA%\\Mastyf Shield\\agent-configs\\custom-<server-name>.json as
      { "mcpServers": { "<server-name>": { "command": ..., "args": [...], "env": {...}, "transport": "stdio" } } }
      Copy env exactly; don't print it.
      For a URL-based server, use instead: "command": "<node.exe path above>", "args": ["<cli.js path above>", "remote-bridge", "--url", "<its url>"], and put any headers in "env": { "MASTYF_AI_REMOTE_HEADERS": "<headers as a JSON string>" }.
   b. Replace the server's entry in your settings with:
      command: <node.exe path>
      args: ["<proxy-launcher.cjs path>", "proxy", "--config", "<the file from step a>", "--policy", "<active-policy.yaml path>", "--blocking-mode", "block"]
      env: {
        "MASTYF_SHIELD_CLI": "<cli.js path>",
        "MASTYF_SHIELD_LICENSE_FILE": "<license.json path>",
        "MASTYF_SHIELD_SITE_URL": "https://www.mastyf.ai",
        "MASTYF_AI_FLEET_CHILD": "true",
        "MASTYF_AI_AGENT": "<your name, lower-case, e.g. my-agent>"
      }
      and add "_mastyf": { "managed": true, "version": 2, "original_command": ..., "original_args": [...], "config_path": "<file from step a>" } so it can be undone.
      Keep any other fields the entry had (timeouts, enabled flags). If your settings use another format (TOML, YAML, a "servers" key), keep that format and put the same values in it.

6. Use full paths with the environment variables expanded, and forward slashes or escaped backslashes as your format needs.

7. Tell me what you changed, where the backup is, and that I need to restart you. After the restart, each routed server's calls appear in Shield's request list.

To undo: restore the backup, or put back each entry's original command and args from "_mastyf".`;

export default function ShieldDocsPage() {
  return (
    <DocPage slug="shield">
      <DocSection id="install" title="Install">
        <DocTable
          head={['Needs', '']}
          rows={[
            ['Windows', 'Windows 10 (build 19041 or later) or Windows 11'],
            ['Plan', <>A paid plan. <Link key="p" href="/pricing">See plans</Link></>],
            ['macOS and Linux', 'Not yet'],
          ]}
        />
        <p>
          <Link href="/download" className="btn btn-primary btn-sm">
            <Download size={13} strokeWidth={2} aria-hidden="true" />
            Download Shield
          </Link>
        </p>
        <p>
          Shield is not code-signed yet, so Windows may show &ldquo;Windows protected your PC&rdquo;. For a file you
          downloaded from mastyf.ai, choose <strong>More info</strong>, then <strong>Run anyway</strong>. Check the file
          first: this should print the SHA-256 shown on the download page.
        </p>
        <DocCode code={HASH} label="Check the installer" />
        <p className="notice notice--warn">
          Install Shield only from mastyf.ai. A copy from anywhere else may have been changed. Don&rsquo;t run it.
        </p>
      </DocSection>

      <DocSection id="activate" title="Activate">
        <p>
          Your licence key appears on your <Link href="/dashboard">dashboard</Link> right after payment. Open Shield and
          paste it on the first screen. A key works on one PC; write to us if you need to move it.
        </p>
      </DocSection>

      <DocSection id="connect" title="Connect your agents">
        <p>
          In Shield, open <strong>Account → Protection</strong> and turn on{' '}
          <strong>Route MCP servers through Shield</strong>. Then restart your agents.
        </p>
        <DocFlow
          label="An agent protected by Shield"
          steps={[
            { label: 'Your agent', sub: 'Claude Code, Cursor, VS Code…' },
            { label: 'Shield', sub: 'free rules + paid checks', tone: 'check' },
            { label: 'Its tools', sub: 'MCP servers, shell, files', tone: 'ok' },
          ]}
        />
        <DocTable
          head={['Agent', 'What Shield checks']}
          rows={[
            ['Claude Code', 'MCP tool calls, shell commands and file access'],
            ['Cursor', 'MCP tool calls, shell commands and file access'],
            ['VS Code (Copilot)', 'MCP tool calls'],
            ['Windsurf', 'MCP tool calls'],
            ['Cline', 'MCP tool calls'],
            ['Claude Desktop', 'MCP tool calls'],
          ]}
        />
      </DocSection>

      <DocSection id="test" title="Check it works">
        <p>
          Click <strong>Run canary test</strong> on Shield&rsquo;s home screen. When something is blocked, click the
          request to see what stopped it: the check, the rule and the words it matched.
        </p>
      </DocSection>

      <DocSection id="other-agents" title="Any other agent">
        <p>
          For an agent Shield doesn&rsquo;t set up itself, paste this prompt into it. It reads its own settings, shows
          you a plan before changing anything, routes each MCP server through Shield and keeps a backup so it can be
          undone.
        </p>
        <DocCode code={PROMPT} label="Prompt that connects an agent to Shield" />
      </DocSection>

      <DocSection id="libraries" title="With the libraries">
        <p>
          With Shield running, the <Link href="/docs/python">Python library</Link> on the same computer uses it on its
          own, with no change to your code. Your agent&rsquo;s calls get Shield&rsquo;s checks and appear in your
          dashboard under the agent&rsquo;s name.
        </p>
      </DocSection>

      <DocSection id="records" title="What is recorded">
        <DocTable
          head={['', 'Where it goes']}
          rows={[
            ['Every call and its decision', 'Kept on your PC, in Shield.'],
            ['One redacted record per call', 'Your workspace on mastyf.ai, for the dashboard. Full arguments never leave your PC.'],
            ['Your conversations with the model', 'Not read. Shield checks what your agents do, not what you say to them.'],
            ['Checks by Protocol X', 'Sent to Mastyf’s servers with your licence, checked, and not stored.'],
          ]}
        />
        <p className="doc-note">
          Protocol X blocks harmful tool results. On tool calls it records what it finds for you to review, while the
          rules block the clearly dangerous ones. See <Link href="/docs/protocol-x">Protocol X</Link>.
        </p>
      </DocSection>

      <DocSection id="receipts" title="Signed receipts">
        <p>
          Every block gets a receipt: what was stopped, by which check and why, signed with a key made on your PC and
          chained to the receipt before it. Changing or removing a receipt breaks the signature or the chain. Export one
          as JSON or PDF from the request panel, for example as evidence for a SOC 2 or ISO 27001 audit.
        </p>
      </DocSection>

      <DocSection id="teams" title="Teams">
        <p>
          On a Team plan, the lead adds a member&rsquo;s email from the dashboard. The member gets a join code by email:
          it works once, expires after 7 days and allows 5 wrong tries. They download Shield, choose{' '}
          <strong>Joining a team? Enter your code</strong>, and get their own one-device key on the Team plan. They
          don&rsquo;t need a website account.
        </p>
      </DocSection>

      <DocSection id="off" title="Turning it off">
        <p>
          Turn <strong>Route MCP servers through Shield</strong> off and every agent&rsquo;s settings go back exactly as
          they were.
        </p>
      </DocSection>
    </DocPage>
  );
}
