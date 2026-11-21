import type { Metadata } from 'next';
import Link from 'next/link';
import { DocCode } from '@/components/docs/DocCode';
import { DocPage, DocSection } from '@/components/docs/DocPage';
import { DocFlow, DocTable } from '@/components/docs/DocVisuals';

export const metadata: Metadata = {
  title: 'GitHub Copilot — Mastyf docs',
  description:
    'Hooks that check every tool call of GitHub Copilot’s coding agent in your repository, with Mastyf’s free checks. Nothing is sent to Mastyf.',
};

const BUILD = `# once: build the hook engine from Mastyf's repository (Node.js 20+, pnpm)
git clone https://github.com/mastyf-ai/mastyf.ai.git
cd mastyf.ai && pnpm install
pnpm --filter @mastyf_ai/check build`;

const SETUP = `# write the hooks into your own repository
node packages/check/dist/mastyf-check.cjs init-copilot --dir /path/to/your-repo

cd /path/to/your-repo
git add .github/hooks/mastyf.json .github/hooks/mastyf/
git commit -m "Check Copilot's tool calls with Mastyf"
git push`;

const UPDATE = `node packages/check/dist/mastyf-check.cjs init-copilot --dir /path/to/your-repo --force`;

export default function CopilotDocsPage() {
  return (
    <DocPage slug="copilot">
      <DocSection id="setup" title="Set up">
        <p>
          The hooks carry their own copy of the engine, so it is built once on your machine and then committed to your
          repository. Until the npm package is published, build it from Mastyf&rsquo;s repository:
        </p>
        <DocCode code={BUILD} label="Build the hook engine" />
        <DocCode code={SETUP} label="Add the hooks to a repository" />
        <p className="doc-note">
          The single-file download from the <Link href="/docs/check#download">check release</Link> can&rsquo;t write the
          hooks: they need the engine as a JavaScript file with its licence beside it, which only the build above
          produces.
        </p>
        <DocTable
          head={['It writes', 'What it is']}
          rows={[
            [<code key="j">.github/hooks/mastyf.json</code>, 'The hooks Copilot reads.'],
            [<code key="d">.github/hooks/mastyf/</code>, 'The hook and the free engine, about 3 MB, so nothing is downloaded during a session.'],
          ]}
        />
        <p>The hooks take effect once they are on your default branch. To update them later:</p>
        <DocCode code={UPDATE} label="Update the hooks" />
      </DocSection>

      <DocSection id="what-happens" title="What happens in a session">
        <DocFlow
          label="A Copilot tool call"
          steps={[
            { label: 'Copilot', sub: 'wants to run a tool' },
            { label: 'Hook: before', sub: 'checks the call', tone: 'check' },
            { label: 'Tool', sub: 'runs if allowed', tone: 'ok' },
            { label: 'Hook: after', sub: 'checks the result', tone: 'check' },
          ]}
        />
        <DocTable
          head={['When', 'What Mastyf does']}
          rows={[
            ['A call is blocked', 'It is denied, and Copilot is told “Blocked by Mastyf (…)”, never what was matched.'],
            ['A result carries hidden instructions', 'It is replaced before Copilot reads it.'],
            ['A result carries a secret', 'The secret is replaced and the cleaned text goes on.'],
            ['The checks can’t run', 'The call is denied and the result withheld.'],
          ]}
        />
        <p className="doc-note">
          The hook answers within 20 seconds, because Copilot lets a call through when a hook takes longer than 30. It is
          built for sessions on GitHub Actions and in GitHub&rsquo;s cloud sandbox. Nothing is sent to Mastyf.
        </p>
      </DocSection>

      <DocSection id="limits" title="Limits">
        <ul className="doc-bullets doc-bullets--warn">
          <li>Blocks show in Copilot&rsquo;s session log. Nothing fails a build and there is no job summary.</li>
          <li>
            Copilot runs commands as the session&rsquo;s user, so an agent that has been misled could work around the
            checks with its shell. Changes to <code>.github/hooks/</code> are refused during a session, as a best effort.
          </li>
          <li>
            The hook needs <code>node</code> in the session; GitHub&rsquo;s environments include it. Without it, calls are
            denied but results are not checked.
          </li>
          <li>Not yet tried in a live Copilot session. Please tell us if anything behaves differently.</li>
        </ul>
      </DocSection>
    </DocPage>
  );
}
