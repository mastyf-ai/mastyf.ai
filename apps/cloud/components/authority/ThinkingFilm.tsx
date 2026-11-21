'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

/**
 * "How the model thinks": the 3-minute film of three real CERT insider cases, with a chapter list
 * that follows the video. Click any step to jump to it. Times match the rendered film
 * (mastyf-videos/authority-thinking); facts on each step are the ones shown on screen.
 */

type Step = { t: number; label: string; fact?: string };
type Chapter = { id: string; kicker: string; title: string; outcome: string; tone: 'hit' | 'miss' | 'sum'; start: number; end: number; steps: Step[] };

const CHAPTERS: Chapter[] = [
  {
    id: 'jack', kicker: 'Case 1 · never done before', title: 'Jack', outcome: 'Caught on day 1', tone: 'hit', start: 0, end: 72.2,
    steps: [
      { t: 0.8, label: '2,000 people, 7 months of normal', fact: 'Every dot is one person' },
      { t: 17.3, label: 'One dot lights up', fact: "Logged into a colleague's computer" },
      { t: 30.6, label: 'Emails files to a personal address', fact: 'Adds 0, most people email outside daily' },
      { t: 38.1, label: 'Opens files for the first time', fact: 'Never in 7 months · 1 in 8 people do' },
      { t: 46.6, label: 'New and rare adds up', fact: 'Day scores 21.7 · most days score 0' },
      { t: 53.6, label: "The reviewer's five", fact: "Jack's day is first on the list" },
    ],
  },
  {
    id: 'laurel', kicker: 'Case 2 · more than ever before', title: 'Laurel', outcome: 'Caught on day 21', tone: 'hit', start: 72.2, end: 108.1,
    steps: [
      { t: 73.4, label: 'Starts looking for another job' },
      { t: 78.8, label: 'Twenty quiet days', fact: 'Job sites: done before, 4 in 10 people' },
      { t: 90.1, label: 'Day 21 beats every record', fact: 'Files 11 vs 5 · USB 8 vs 6' },
      { t: 101.3, label: 'Tops the list that morning', fact: '#1 of 2,000' },
    ],
  },
  {
    id: 'murphy', kicker: 'Case 3 · when the model misses', title: 'Murphy', outcome: 'Missed, held by a limit', tone: 'miss', start: 108.1, end: 141.5,
    steps: [
      { t: 109.5, label: '4 files to Dropbox in a minute' },
      { t: 117.0, label: 'The model sees nothing', fact: 'Uploads on 44 earlier days · adds 0' },
      { t: 124.7, label: 'Ranks #2,384 of 4,000', fact: 'No reviewer would look' },
      { t: 131.0, label: 'Not on the approved list', fact: 'Waits for a second person' },
    ],
  },
  {
    id: 'close', kicker: 'All seven test companies', title: '179 of 187', outcome: 'No attack examples used', tone: 'sum', start: 141.5, end: 172.5,
    steps: [
      { t: 143.1, label: 'Insiders put on the reviewer’s list' },
      { t: 153.2, label: 'The 8 it missed', fact: 'Limits decide how much can leave' },
      { t: 158.1, label: 'Three questions, every action', fact: 'Done before? How many? More than ever?' },
    ],
  },
];

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function ThinkingFilm() {
  const ref = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const tick = () => setNow(v.currentTime);
    const on = () => setPlaying(true);
    const off = () => setPlaying(false);
    v.addEventListener('timeupdate', tick);
    v.addEventListener('seeked', tick);
    v.addEventListener('play', on);
    v.addEventListener('pause', off);
    v.addEventListener('ended', off);
    return () => {
      v.removeEventListener('timeupdate', tick);
      v.removeEventListener('seeked', tick);
      v.removeEventListener('play', on);
      v.removeEventListener('pause', off);
      v.removeEventListener('ended', off);
    };
  }, []);

  const jump = useCallback((t: number) => {
    const v = ref.current;
    if (!v) return;
    v.currentTime = t;
    setNow(t);
    // on one-column layouts the list sits below the video: bring the video back into view
    const r = v.getBoundingClientRect();
    if (window.innerWidth < 900 && (r.bottom < 80 || r.top > window.innerHeight - 80)) {
      v.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    void v.play().catch(() => {});
  }, []);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };

  const active = CHAPTERS.find((c) => now >= c.start && now < c.end) ?? CHAPTERS[0];
  const activeStep = [...active.steps].reverse().find((s) => now >= s.t - 0.05);

  return (
    <div className="tf">
      <figure className="tf__film">
        <video
          ref={ref}
          className="tf__video"
          controls
          playsInline
          preload="metadata"
          poster="/media/model-thinks-poster.jpg"
          aria-label="How the model thinks: three insider cases"
        >
          <source src="/media/model-thinks.mp4" type="video/mp4" />
          Your browser does not support the video tag.
        </video>
      </figure>

      <div className="tf__side">
        <div className="tf__bar">
          <button type="button" className="tf__play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={14} strokeWidth={2} aria-hidden="true" /> : <Play size={14} strokeWidth={2} aria-hidden="true" />}
          </button>
          <div className="tf__track" aria-hidden="true">
            {CHAPTERS.map((c) => {
              const w = c.end - c.start;
              const fill = Math.max(0, Math.min(1, (now - c.start) / w));
              return (
                <button
                  type="button"
                  key={c.id}
                  tabIndex={-1}
                  className={`tf__seg tf__seg--${c.tone}`}
                  style={{ flexGrow: w }}
                  onClick={() => jump(c.start + 0.01)}
                >
                  <i style={{ transform: `scaleX(${fill})` }} />
                </button>
              );
            })}
          </div>
          <span className="tf__time">{fmt(now)} / 2:52</span>
        </div>

        <ol className="tf__chapters">
          {CHAPTERS.map((c) => {
            const on = c.id === active.id;
            return (
              <li key={c.id} className={`tf__ch tf__ch--${c.tone}${on ? ' is-on' : ''}`}>
                <button type="button" className="tf__head" onClick={() => jump(c.steps[0].t - 0.6)} aria-current={on ? 'step' : undefined}>
                  <span className="tf__kicker">{c.kicker}</span>
                  <span className="tf__title">{c.title}</span>
                  <span className="tf__outcome">{c.outcome}</span>
                </button>
                {on && (
                  <ul className="tf__steps">
                    {c.steps.map((s) => {
                      const cur = s === activeStep;
                      const past = now >= s.t;
                      return (
                        <li key={s.t}>
                          <button
                            type="button"
                            className={`tf__step${cur ? ' is-cur' : ''}${past ? ' is-past' : ''}`}
                            onClick={() => jump(s.t - 0.3)}
                          >
                            <span className="tf__t">{fmt(s.t)}</span>
                            <span className="tf__lbl">{s.label}</span>
                            {s.fact && <span className="tf__fact">{s.fact}</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
        <p className="tf__note">
          Cases from CMU&apos;s CERT insider-threat datasets (computer-generated logs), scored by the published method. Click any
          step to jump to it.
        </p>
      </div>
    </div>
  );
}
