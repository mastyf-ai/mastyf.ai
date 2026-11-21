import type { Metadata } from 'next';
import { DocCode } from '@/components/docs/DocCode';
import { DocPage, DocSection } from '@/components/docs/DocPage';
import { DocTable } from '@/components/docs/DocVisuals';

export const metadata: Metadata = {
  title: 'Rules — Mastyf docs',
  description:
    'What Mastyf’s free checks block out of the box, what they check in tool results, and how to write and test your own rules file.',
};

const OWN = `version: '1.0'
policy:
  mode: block
  default_action: pass
  rules:
    - name: no-prod-database
      description: Never let the agent touch the production database
      action: block
      argPatterns:
        - field: connection
          patterns: ['prod-db\\.internal']

    - name: no-deleting
      action: block
      tools:
        deny: [delete_file, delete_repository, drop_table]

    - name: slow-down
      action: block
      maxCallsPerMinute: 30`;

const USE = `mastyf-check serve --policy ./my-rules.yaml
mastyf-check proxy --policy ./my-rules.yaml -- <your MCP server>`;

const OBSERVE = `mastyf-check serve --policy ./my-rules.yaml --mode observe`;

const OBSERVED = `{ "decision": "allow", "observed": true, "rule": "no-deleting",
  "reason": "Would have blocked: …" }`;

export default function RulesDocsPage() {
  return (
    <DocPage slug="rules">
      <DocSection id="default" title="What is blocked by default">
        <p>Every call passes two kinds of check. Anything neither of them matches is allowed.</p>
        <DocTable
          head={['Check', 'Can you change it?', 'Example verdict']}
          rows={[
            ['Built-in guards: sensitive paths, risky SQL, risky URLs, prompt injection in arguments, changed tool lists', 'No, they always run', <code key="g">semantic-path-guard</code>],
            ['The rules file below', 'Yes, with your own file', <code key="r">block-shell-injection</code>],
          ]}
        />
        <p>The rules Mastyf ships with:</p>
        <DocTable
          head={['Rule', 'Blocks', 'For example']}
          rows={[
            [<code key="1">block-sensitive-paths</code>, 'Reading credentials, SSH keys, env files, cloud and Kubernetes configs', <code key="e1">~/.ssh/id_rsa</code>],
            [<code key="2">block-path-traversal</code>, 'Climbing out of a folder', <code key="e2">../../etc/passwd</code>],
            [<code key="3">block-shell-injection</code>, 'Download-and-run, recursive deletes, encoded PowerShell', <code key="e3">curl … | sh</code>],
            [<code key="4">block-reverse-shell</code>, 'Remote shells, C2 callbacks, tunnels', <code key="e4">bash -i &gt;&amp; /dev/tcp/…</code>],
            [<code key="5">block-data-exfil-tools</code>, 'Sending data out with cloud CLIs, git push, scp, rsync', <code key="e5">aws s3 cp</code>],
            [<code key="6">block-sql-exfil</code>, 'Bulk dumps and destructive SQL, NoSQL and LDAP injection', <code key="e6">SELECT * FROM users</code>],
            [<code key="7">block-dangerous-urls</code>, 'Cloud metadata, localhost, private IPs, file: and javascript: links', <code key="e7">169.254.169.254</code>],
            [<code key="8">block-credential-patterns-expanded</code>, 'API keys, tokens and private keys inside arguments', <code key="e8">AKIA…, ghp_…</code>],
            [<code key="9">block-encoding-evasion</code>, 'Long base64 or hex blobs used to hide instructions', '—'],
            [<code key="10">block-result-injection</code>, 'Classic injection phrases passed on as arguments', <code key="e10">Ignore all previous instructions</code>],
            [<code key="11">block-privilege-escalation</code>, 'Asking for admin or root, wildcard permissions', <code key="e11">role: admin</code>],
            [<code key="12">block-graphql-injection</code>, 'Schema introspection and very deep queries', <code key="e12">__schema</code>],
            [<code key="13">block-resource-exhaustion</code>, 'Unbounded limits, infinite loops, no timeouts', <code key="e13">limit: -1</code>],
            [<code key="14">deny-dangerous-tools</code>, 'Tools that only exist to run code or open raw connections', <code key="e14">eval, netcat</code>],
            [<code key="15">deny-github-write-tools</code>, 'Deleting repositories and branches', <code key="e15">delete_repository</code>],
            [<code key="16">burst-rate-limit</code>, 'More than 40 calls in 10 seconds to one tool', '—'],
            [<code key="17">rate-limit-tool-calls</code>, 'More than 120 calls a minute to one tool', '—'],
            [<code key="18">token-budget</code>, 'A single call over 50,000 tokens', '—'],
          ]}
        />
      </DocSection>

      <DocSection id="results" title="Checks on tool results">
        <p>Results are checked before the model reads them, whatever rules file you use.</p>
        <DocTable
          head={['Found in a result', 'What happens']}
          rows={[
            ['Instructions aimed at the agent, hidden in a page, file or message', <>Blocked: the model never sees it (<code key="b">decision: block</code>).</>],
            ['A secret such as an API key or private key', <>Replaced, and the cleaned result goes on (<code key="r">decision: redact</code>).</>],
            ['A tool list that changed after it was first seen', 'The server’s calls are blocked from then on.'],
          ]}
        />
      </DocSection>

      <DocSection id="own-rules" title="Your own rules file">
        <p>
          Your file replaces the rules above (the built-in guards keep running), so start from a copy of{' '}
          <a
            href="https://github.com/mastyf-ai/mastyf.ai/blob/main/packages/check/check-default-policy.yaml"
            target="_blank"
            rel="noopener noreferrer"
          >
            the default rules
          </a>{' '}
          if you want to keep them and add your own. The format is YAML:
        </p>
        <DocCode code={OWN} label="my-rules.yaml" />
        <DocCode code={USE} label="Use your rules file" />
      </DocSection>

      <DocSection id="fields" title="Rule fields">
        <DocTable
          head={['Field', 'What it does']}
          rows={[
            [<code key="n">name</code>, 'Required. Shown in every verdict this rule makes.'],
            [<code key="a">action</code>, <>Required. <code>block</code> stops the call, <code>flag</code> records it without stopping, <code>pass</code> allows it.</>],
            [<code key="t">tools.deny</code>, 'Tool names this rule applies to.'],
            [<code key="ta">tools.allow</code>, <>Only these tools are allowed (with <code>default_action: block</code>).</>],
            [<code key="ap">argPatterns</code>, <>Regular expressions matched against one argument: <code>field</code> is its name, or <code>*</code> for every argument.</>],
            [<code key="p">patterns</code>, 'Regular expressions matched against the whole call.'],
            [<code key="mc">maxCallsPerMinute</code>, 'Rate limit per tool.'],
            [<code key="m10">maxCallsPer10Seconds</code>, 'Burst limit per tool.'],
            [<code key="mt">maxTokens</code>, 'Largest single call, in tokens.'],
            [<code key="e">enabled</code>, <>Set to <code>false</code> to switch a rule off without deleting it.</>],
            [<code key="da">default_action</code>, <>At the top of the file: what happens to a call no rule matched. Usually <code>pass</code>.</>],
          ]}
        />
      </DocSection>

      <DocSection id="observe" title="Try rules without blocking">
        <p>
          Run the checks in observe mode first. Everything is allowed, and anything that would have been blocked is
          marked, so you can see what a new rule catches before it stops real work.
        </p>
        <DocCode code={OBSERVE} label="Observe mode" />
        <DocCode code={OBSERVED} label="A call that would have been blocked" />
        <p className="doc-note">
          Leave <code>mode: block</code> at the top of the file. Use <code>--mode observe</code> to try rules, not the
          file&rsquo;s <code>mode</code>: <code>audit</code> there turns every rule off.
        </p>
      </DocSection>
    </DocPage>
  );
}
