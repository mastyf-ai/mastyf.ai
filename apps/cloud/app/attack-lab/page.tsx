import type { Metadata } from 'next';
import { BENIGN_CHECK, GENERATED, PX_RESULTS } from './data';
import { AttackGallery } from './AttackGallery';
import { HowItWorksSim } from './GateSim';
import { Playground } from './Playground';
import './attack-lab.css';

export const metadata: Metadata = {
  title: 'Attack Lab — Mastyf',
  description:
    'Watch Protocol X, the Mastyf decision model, stop common and novel MCP attacks. Every simulation replays a real recorded verdict.',
};

export default function AttackLabPage() {
  return (
    <main id="main" className="docs__main alab">
      <header id="top" className="docs__intro alab-intro">
        <h1>Watch Protocol X stop attacks it has never seen</h1>
        <p>Every run on this page is a real recorded verdict.</p>
        <dl className="alab-stats">
          <div>
            <dt>Attacker success</dt>
            <dd>
              <span className="alab-stats__from">{PX_RESULTS.agentdojo.before}</span> →{' '}
              <span className="alab-stats__to">{PX_RESULTS.agentdojo.after}</span>
            </dd>
            <span className="alab-stats__note">No defense vs Protocol X, AgentDojo, {PX_RESULTS.agentdojo.cases} attacked cases</span>
          </div>
          <div>
            <dt>Novel attacks generated</dt>
            <dd>{PX_RESULTS.novelAttacks}</dd>
            <span className="alab-stats__note">By our red team, none in the model&apos;s training data</span>
          </div>
          <div>
            <dt>Ordinary calls allowed</dt>
            <dd>
              {BENIGN_CHECK.allowed} / {BENIGN_CHECK.scored}
            </dd>
            <span className="alab-stats__note">Benign corpus calls scored in the same check</span>
          </div>
          <div>
            <dt>Decision time</dt>
            <dd>{PX_RESULTS.decisionTime}</dd>
            <span className="alab-stats__note">Median, on a laptop CPU</span>
          </div>
        </dl>
      </header>

      <section id="how-it-works" className="doc-section">
        <h2>How Protocol X works</h2>
        <p>It judges what a call asks for, not which tool it uses.</p>
        <div className="doc-block">
          <HowItWorksSim />
        </div>
      </section>

      <section id="try" className="doc-section">
        <h2>Try an attack</h2>
        <p>Pick what to make the agent do and how to hide it, then send it.</p>
        <div className="doc-block">
          <Playground />
        </div>
      </section>

      <section id="attacks" className="doc-section">
        <h2>Every attack</h2>
        <p>Pick one to watch it run. The percentage is how many red-team variants of it are caught.</p>
        <AttackGallery />
      </section>

      <section id="method" className="doc-section">
        <h2>Method and limits</h2>
        <ul className="doc-bullets">
          <li>
            Every verdict, probability and decision time on this page is the production model&apos;s own output, recorded
            on a laptop CPU. The animation replays those numbers; it does not invent them.
          </li>
          <li>
            Novel attacks are built by re-expressing vetted corpus payloads in new structures held out of training. Each
            one is checked against the training set and dropped if it is too similar.
          </li>
          <li>
            We only publish structures Protocol X reliably blocks. Structures where it is weaker today are being worked
            on and will appear here once a shipped model handles them.
          </li>
          <li>
            Try an attack replays examples from 387 recorded attacks in the three disguises above and 180 harmless
            versions of them. The count under each example covers every recording for that choice, not just the
            five you can step through.
          </li>
          <li>
            Payloads are defanged for display: hosts, addresses and long blobs are replaced with examples.
          </li>
          <li>
            Protocol X is a probabilistic defense. It raises the cost of an attack sharply; it is not a guarantee. When
            it is unsure, Mastyf blocks.
          </li>
        </ul>
        <p className="doc-note alab-snapshot">Snapshot {GENERATED}.</p>
      </section>
    </main>
  );
}
