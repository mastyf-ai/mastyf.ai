import type { Metadata } from 'next';
import { ATTACKS, BENIGN_CHECK, GENERATED, type AttackEntry } from './data';
import { AttackSim, HowItWorksSim } from './GateSim';
import { Playground, ThenAndNow } from './Playground';
import './attack-lab.css';

export const metadata: Metadata = {
  title: 'Attack Lab — Mastyf',
  description:
    'Watch Protocol X, the Mastyf decision model, stop common and novel MCP attacks. Every simulation replays a real recorded verdict.',
};

function AttackArticle({ a }: { a: AttackEntry }) {
  return (
    <article id={a.id} className="alab-attack">
      <div className="alab-attack__head">
        <h3>{a.title}</h3>
        <span className={`badge alab-tag alab-tag--${a.section}`}>{a.section === 'novel' ? 'Novel' : 'Common'}</span>
        {a.catch ? <span className="alab-attack__catch">{a.catch} of red-team variants caught</span> : null}
      </div>
      <p className="alab-attack__how">{a.how}</p>
      <AttackSim a={a} />
    </article>
  );
}

export default function AttackLabPage() {
  const novel = ATTACKS.filter((a) => a.section === 'novel');
  const common = ATTACKS.filter((a) => a.section === 'common');

  return (
    <main id="main" className="docs__main alab">
      <header id="top" className="docs__intro alab-intro">
        <p className="label alab-eyebrow">Attack Lab</p>
        <h1>Watch Protocol X stop attacks it has never seen</h1>
        <p>
          Protocol X is the decision model inside Mastyf. It reads every tool call your agent makes, and every result a
          tool sends back, and decides before anything runs. Each simulation on this page replays a real recorded
          verdict.
        </p>
        <dl className="alab-stats">
          <div>
            <dt>Attacker success</dt>
            <dd>
              <span className="alab-stats__from">25%</span> → <span className="alab-stats__to">0%</span>
            </dd>
            <span className="alab-stats__note">No defense vs Protocol X, AgentDojo, 249 attacked cases</span>
          </div>
          <div>
            <dt>Novel attacks generated</dt>
            <dd>777</dd>
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
            <dd>~1 s</dd>
            <span className="alab-stats__note">Median, on a laptop CPU</span>
          </div>
        </dl>
      </header>

      <section id="how-it-works" className="doc-section">
        <h2>How Protocol X works</h2>
        <p>
          Mastyf sits between your agent and its tools. Every call goes through it on the way out, and every result on
          the way back. Protocol X reads each one in a single forward pass and returns a verdict before the call runs.
          The same tool can be fine or dangerous depending on what it is asked to do, so it judges the call, not the
          tool name.
        </p>
        <div className="doc-block">
          <HowItWorksSim />
        </div>
      </section>

      <section id="try" className="doc-section">
        <h2>Try an attack</h2>
        <p>
          Play the attacker. Pick what you want the agent to do and how to hide it, then send it through Protocol X.
          Every verdict is a real recording from our red team, including the ones that got through. Switch on the
          harmless version to check the model isn&apos;t just blocking anything that looks unusual.
        </p>
        <div className="doc-block">
          <Playground />
        </div>
      </section>

      <section id="then-and-now" className="doc-section">
        <h2>Then and now</h2>
        <p>
          Our red team invents disguises the model has never seen. We scored the previous release against the same
          attacks and the same harmless text as the current one, so you can see whether the model got better at
          stopping them and whether it started blocking normal work.
        </p>
        <ThenAndNow />
      </section>

      <section id="novel" className="doc-section">
        <h2>Novel attacks</h2>
        <p>
          Our red team invents new ways to smuggle an instruction past a guard, in structures the model was never
          trained on, then measures whether Protocol X still catches them. These three it does. Each one plays as you
          reach it.
        </p>
        {novel.map((a) => (
          <AttackArticle key={a.id} a={a} />
        ))}
      </section>

      <section id="common" className="doc-section">
        <h2>Common attacks</h2>
        <p>
          The attack classes every MCP agent faces. Each simulation replays a real block from Mastyf&apos;s vetted attack
          corpus.
        </p>
        {common.map((a) => (
          <AttackArticle key={a.id} a={a} />
        ))}
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
            five you can step through. Then and now scores the previous release on exactly the same text.
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
