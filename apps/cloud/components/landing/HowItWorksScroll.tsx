'use client';

import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Bot, FileText, Globe, Lock, ShieldCheck, SquareTerminal } from 'lucide-react';
import '@/app/design/how-scroll.css';

/**
 * "How Mastyf works": a loop that plays while the stage is on screen. Three requests travel from
 * the AI to Mastyf; Protocol X reads each one; two pass through to their target, one is stopped at
 * the gate. The step text follows along. Reduced motion gets the finished picture.
 */

const STEPS = [
  { title: 'Your AI asks to do something', body: 'Open a file, run a command, send something over the internet.' },
  { title: 'Mastyf reads it first', body: 'Protocol X, Mastyf’s checking model, looks at what is really being asked.' },
  { title: 'Safe goes through. Harmful stops.', body: 'Every decision is written down, so you can see what was tried.' },
] as const;

type Target = 'files' | 'terminal' | 'internet';

const TARGETS: { id: Target; label: string; x: number; y: number; Icon: typeof FileText }[] = [
  { id: 'files', label: 'Your files', x: 88, y: 18, Icon: FileText },
  { id: 'terminal', label: 'Your terminal', x: 88, y: 50, Icon: SquareTerminal },
  { id: 'internet', label: 'The internet', x: 88, y: 82, Icon: Globe },
];

const REQUESTS: { id: string; label: string; target: Target; ok: boolean; log: string }[] = [
  { id: 'a', label: 'Open report.pdf', target: 'files', ok: true, log: 'Open report.pdf' },
  { id: 'b', label: 'Send passwords out', target: 'internet', ok: false, log: 'Send passwords to collect-data.net' },
  { id: 'c', label: 'Run the tests', target: 'terminal', ok: true, log: 'Run the tests' },
];

const AGENT = { x: 10, y: 50 };
const GATE = { x: 50, y: 50 };
const WAIT_X = 29; // where a request waits while Protocol X reads it

/** Which step text goes with a moment of the timeline: the first request travels, is read, then the rest play out. */
const stepAt = (t: number) => (t < 1.1 ? 0 : t < 3.2 ? 1 : 2);

export function HowItWorksScroll() {
  const rootRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    gsap.registerPlugin(ScrollTrigger);

    const mm = gsap.matchMedia();
    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(root);
      const setStep = (i: number) => {
        if (root.dataset.step !== String(i)) root.dataset.step = String(i);
      };

      const build = () => {
        const tl = gsap.timeline({ defaults: { ease: 'none' } });
        const gate = q('.hiw__gate')[0];
        const beam = q('.hiw__beam')[0];

        gsap.set(q('.hiw__req'), { xPercent: -50, yPercent: -50, left: `${AGENT.x}%`, top: `${AGENT.y}%`, autoAlpha: 0, scale: 0.6 });
        gsap.set(q('.hiw__log li'), { autoAlpha: 0, y: 10 });
        gsap.set(q('.hiw__hit, .hiw__lock, .hiw__stamp, .hiw__verdict span'), { autoAlpha: 0 });
        gsap.set(beam, { scaleX: 0, autoAlpha: 0 });

        REQUESTS.forEach((r, i) => {
          const el = q(`.hiw__req[data-req="${r.id}"]`)[0];
          const t = TARGETS.find((x) => x.id === r.target)!;
          const at = i * 3.2;
          const verdict = q(`.hiw__verdict-${r.ok ? 'ok' : 'no'}`)[0];
          const reading = q('.hiw__verdict-read')[0];
          tl.addLabel(`r${i}`, at)
            // appears at the AI and travels to the gate
            .to(el, { autoAlpha: 1, scale: 1, duration: 0.3, ease: 'back.out(2)' }, at)
            .to(el, { left: `${WAIT_X}%`, duration: 0.8, ease: 'power1.inOut' }, at + 0.3)
            // Protocol X reads it
            .to(beam, { autoAlpha: 1, scaleX: 1, duration: 0.25 }, at + 1.1)
            .to(gate, { '--gate-spin': 1, duration: 0.6 }, at + 1.1)
            .to(reading, { autoAlpha: 1, duration: 0.15 }, at + 1.1)
            .to(reading, { autoAlpha: 0, duration: 0.15 }, at + 1.65)
            .to(beam, { autoAlpha: 0, scaleX: 0, duration: 0.2 }, at + 1.7)
            .to(gate, { '--gate-spin': 0, duration: 0.3 }, at + 1.7)
            .to(verdict, { autoAlpha: 1, duration: 0.15 }, at + 1.8)
            .to(gate, { '--gate-ok': r.ok ? 1 : 0, '--gate-no': r.ok ? 0 : 1, duration: 0.2 }, at + 1.8);

          if (r.ok) {
            tl.to(el, { left: `${t.x - 9}%`, top: `${t.y}%`, duration: 0.8, ease: 'power1.inOut' }, at + 2.0)
              .to(q(`.hiw__target[data-target="${t.id}"] .hiw__hit`), { autoAlpha: 1, duration: 0.2 }, at + 2.7)
              .to(el, { autoAlpha: 0, scale: 0.7, duration: 0.25 }, at + 2.8);
          } else {
            tl.to(el, { '--req-bad': 1, duration: 0.15 }, at + 1.8)
              .to(el, { x: 8, duration: 0.05, repeat: 5, yoyo: true }, at + 1.95)
              .to(q('.hiw__stamp'), { autoAlpha: 1, duration: 0.01 }, at + 2.1)
              .fromTo(q('.hiw__stamp'), { scale: 1.8, rotate: -14 }, { scale: 1, rotate: -8, duration: 0.3, ease: 'back.out(2)' }, at + 2.1)
              .to(q(`.hiw__target[data-target="${t.id}"] .hiw__lock`), { autoAlpha: 1, duration: 0.2 }, at + 2.3)
              .to(el, { autoAlpha: 0, y: 40, scale: 0.8, duration: 0.5, ease: 'power2.in' }, at + 2.5)
              .to(q('.hiw__stamp'), { autoAlpha: 0, duration: 0.2 }, at + 2.9);
          }

          tl.to(q(`.hiw__log li[data-req="${r.id}"]`), { autoAlpha: 1, y: 0, duration: 0.3 }, at + 2.4)
            .to(verdict, { autoAlpha: 0, duration: 0.15 }, at + 2.9)
            .to(gate, { '--gate-ok': 0, '--gate-no': 0, duration: 0.2 }, at + 2.95);
        });
        return tl;
      };

      // Loops on its own while the stage is on screen, and pauses when it is not.
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const tl = build();
        // Hold the finished log for a moment, then clear it so the next pass starts clean.
        tl.to({}, { duration: 1.6 })
          .to(q('.hiw__log li, .hiw__hit, .hiw__lock'), { autoAlpha: 0, duration: 0.4 })
          .to({}, { duration: 0.3 });
        tl.repeat(-1).pause();
        tl.eventCallback('onUpdate', () => setStep(stepAt(tl.time())));
        setStep(0);
        ScrollTrigger.create({
          trigger: q('.hiw__stage')[0],
          start: 'top 85%',
          end: 'bottom 15%',
          onToggle: (self) => (self.isActive ? tl.play() : tl.pause()),
        });
      });

      // Reduced motion: the finished picture.
      mm.add('(prefers-reduced-motion: reduce)', () => {
        const tl = build();
        tl.to({}, { duration: 0.6 });
        tl.progress(1).pause();
        gsap.set(q('.hiw__log li'), { autoAlpha: 1, y: 0 });
        root.dataset.step = 'all';
      });
    }, root);

    return () => {
      mm.revert();
      ctx.revert();
    };
  }, []);

  return (
    <section className="hiw" id="how-it-works" aria-labelledby="how-title" ref={rootRef} data-step="all">
      <div className="hiw__inner">
        <div className="hiw__copy">
          <h2 id="how-title">How Mastyf works</h2>
          <ol className="hiw__steps">
            {STEPS.map((s, i) => (
              <li key={s.title} data-i={i}>
                <span className="hiw__bar" aria-hidden="true" />
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="hiw__visual" aria-hidden="true">
          <div className="hiw__stage">
            <svg className="hiw__wires" viewBox="0 0 100 100" preserveAspectRatio="none">
              <line x1={AGENT.x} y1={AGENT.y} x2={GATE.x} y2={GATE.y} />
              {TARGETS.map((t) => (
                <line key={t.id} x1={GATE.x} y1={GATE.y} x2={t.x} y2={t.y} />
              ))}
            </svg>

            <div className="hiw__node hiw__agent" style={{ left: `${AGENT.x}%`, top: `${AGENT.y}%` }}>
              <span className="hiw__disc">
                <Bot size={26} strokeWidth={1.6} />
              </span>
              <span className="hiw__name">Your AI</span>
            </div>

            <div className="hiw__gate" style={{ left: `${GATE.x}%`, top: `${GATE.y}%` }}>
              <span className="hiw__beam" />
              <span className="hiw__ring" />
              <span className="hiw__core">
                <ShieldCheck size={30} strokeWidth={1.6} />
              </span>
              <span className="hiw__name hiw__name--gate">
                Mastyf
                <small>Protocol X inside</small>
              </span>
              <span className="hiw__verdict">
                <span className="hiw__verdict-read">Reading…</span>
                <span className="hiw__verdict-ok">Allowed</span>
                <span className="hiw__verdict-no">Stopped</span>
              </span>
              <span className="hiw__stamp">Stopped</span>
            </div>

            {TARGETS.map(({ id, label, x, y, Icon }) => (
              <div key={id} className="hiw__node hiw__target" data-target={id} style={{ left: `${x}%`, top: `${y}%` }}>
                <span className="hiw__disc">
                  <Icon size={22} strokeWidth={1.6} />
                  <span className="hiw__hit" />
                  <span className="hiw__lock">
                    <Lock size={12} strokeWidth={2} />
                  </span>
                </span>
                <span className="hiw__name">{label}</span>
              </div>
            ))}

            {REQUESTS.map((r) => (
              <span key={r.id} className={`hiw__req${r.ok ? '' : ' hiw__req--bad'}`} data-req={r.id}>
                {r.label}
              </span>
            ))}
          </div>

          <ol className="hiw__log">
            {REQUESTS.map((r) => (
              <li key={r.id} data-req={r.id} className={r.ok ? 'is-ok' : 'is-no'}>
                <span className="hiw__log-mark" />
                <span className="hiw__log-text">{r.log}</span>
                <span className="hiw__log-verdict">{r.ok ? 'Allowed' : 'Stopped'}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
