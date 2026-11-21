'use client';

import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';

const SRC = '/media/mastyf-six-attacks-16x9.mp4';
const POSTER = '/media/mastyf-six-attacks-16x9-poster.jpg';

// Matches the captions burned into the video (generated from the video's narration script).
const TRANSCRIPT = [
  "Five days in November. Japan's flagship supercomputer. Twenty-two million people in France. The websites of a hundred and seventy-eight organisations. Europe's largest gas supplier. And a government, robbed for five years. Almost none of these attackers broke a lock. They used something the system already trusted.",
  "Here is how each attack happened, and the exact moment Mastyf would have stopped it. Mastyf has two layers. Mastyf AI checks every action an AI agent takes, before it runs. Mastyf Authority puts a hard ceiling on what any account can do, whether it's a person, a server, or an AI agent.",
  "Saturday, four thirty in the morning. Japan switches off Fugaku, its flagship supercomputer. One report says the attackers came in through a public status page. They took the details of up to four thousand, two hundred and twenty-two users, along with the private keys many had stored on the machine. Then they tried those keys on other systems. With Authority, a key only works from its owner's registered device. A copy on an attacker's laptop opens nothing. Logins from stolen keys: zero.",
  "Same day, in France. La Poste reveals that a September attack on Maileva, its business mail service, exposed the names and home addresses of twenty-two million people. Most were never customers. They simply received a letter. Authority gives every account a damage budget, like a credit limit for data. Say, five thousand records a day. At that rate, twenty-two million records would take twelve years. Hidden among the real records are bait ones. Touch one, and the account freezes. And every record that leaves carries an invisible mark of who took it.",
  "Monday, four twenty-one a.m. Attackers slip code into Optimizely, a tool big websites load on their pages. It goes live on the sites of a hundred and seventy-eight organisations, including the BBC, CNN, Zoom and HSBC. By the afternoon, it is copying card numbers at checkout. It swaps crypto wallet addresses. It tries to break into iPhones. The clean-up runs until almost ten at night. With Authority, a site only serves the version of a vendor's script it approved. A pinned copy. A changed script needs a second person's sign-off before any visitor sees it. Visitors served the skimmer: zero.",
  "Tuesday. Equinor, Europe's largest gas supplier, says it is fighting an attack on its IT systems, still in progress. Production keeps running. How the attackers got in has not been made public. Authority doesn't need to know. Whatever the way in, the attacker gets the same budget as the account they took. And anything that can't be undone has to wait. Mass deletions sit in a twenty-four hour undo window. Deleting backups: seventy-two. Rewriting protected code needs a second person's passkey. One click, and it's all cancelled.",
  "Wednesday. Bulgaria reveals that hackers had been inside its government networks since twenty twenty-one. More than a hundred and thirty gigabytes. Sixty-two million pages of documents. Nobody noticed, until a new monitoring system was switched on in August. Authority's behaviour model learns what normal work looks like for every account. A first visit to a new system stands out. So does volume that creeps up, day after day. And a patient attacker still hits the same ceiling, every single day. Five quiet years would have to get past the budget, the bait and the model, every day.",
  "And on Monday, Google's threat intelligence team reported a first. An attacker's AI agent compared software before and after a security patch, found the flaw, wrote an exploit and launched it, with no human in the loop. Attacks at machine speed. A budget doesn't care how fast you are. A machine hits the ceiling in milliseconds, and stops there. But attackers aren't only using AI agents. They are coming for yours.",
  "In June, researchers showed how. They hid instructions inside an ordinary-looking error report. A coding agent read it while fixing a bug, and treated it as its task, running commands and installing packages. It worked in lab tests against popular coding agents. Stopping this is the job of Mastyf AI. Here's how it works. Your agent never talks to its tools directly. Every call it makes passes through Mastyf AI on the way out. Every result passes through it on the way back. Inside is Protocol X, our decision model. It reads each one and decides in about a second, before anything runs. It judges what is being asked, not which tool. Read the project readme: allowed. Same tool, read the password file: blocked. Now the poisoned error report comes back. Protocol X spots an instruction aimed at the agent, hiding inside the data. Blocked. The agent never sees it. Our red team invents disguises the model has never seen. A fake error, demanding the attacker's step first: ninety-three percent caught. An instruction cut into harmless pieces: a hundred percent. On AgentDojo, a public benchmark for hijacking agents, attack success fell from twenty-five percent to zero, and normal tasks finished just as often. When it's unsure, it blocks.",
  'Two layers. Mastyf AI asks: is this action what it claims to be? Mastyf Authority asks: even if it isn\'t, how much can it take? Slip past one, and you still hit the other.',
  'Tested against twenty-eight MITRE ATT&CK techniques, twenty-two were blocked, capped, delayed or caught. On real insider data, the behaviour model caught a hundred and sixty-eight of two hundred and thirty-one insiders.',
  'Attackers will get in. With Mastyf, what they can take is a number you choose.',
];

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00';
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function ExplainerVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  // Once the visitor pauses, scrolling back into view must not restart playback.
  const userPaused = useRef(false);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    const frame = frameRef.current;
    if (!video || !frame) return;
    // Browsers only allow autoplay without sound.
    video.muted = true;
    // Metadata can load before hydration, in which case onLoadedMetadata never fires.
    if (video.readyState >= 1) setDuration(video.duration);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (!reduced && !userPaused.current && video.paused && !video.ended) video.play().catch(() => {});
        } else if (!video.paused) {
          video.pause();
        }
      },
      { threshold: 0.5 }
    );
    io.observe(frame);
    return () => io.disconnect();
  }, []);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) {
      userPaused.current = false;
      video.play().catch(() => {});
    } else {
      userPaused.current = true;
      video.pause();
    }
  };

  const toggleSound = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    // Turning sound on is a clear request to watch.
    if (!video.muted && video.paused) {
      userPaused.current = false;
      video.play().catch(() => {});
    }
  };

  const seek = (value: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = value;
    setTime(value);
  };

  const fraction = duration ? time / duration : 0;
  const started = playing || time > 0;

  return (
    <div className="panel video" data-reveal>
      <div className="video__frame" ref={frameRef}>
        <video
          ref={videoRef}
          src={SRC}
          poster={POSTER}
          preload="metadata"
          playsInline
          muted
          onClick={togglePlay}
          onPlay={() => {
            setPlaying(true);
            setEnded(false);
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setEnded(true);
          }}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onDurationChange={(e) => setDuration(e.currentTarget.duration)}
          onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
          aria-label="Six attacks, stopped: a video with burned-in captions"
        />
        {!started || ended ? (
          <button type="button" className="video__overlay" onClick={togglePlay}>
            <span>
              {ended ? (
                <RotateCcw size={15} strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <Play size={15} strokeWidth={1.75} aria-hidden="true" />
              )}
              {ended ? 'Watch again' : 'Play video'}
            </span>
          </button>
        ) : null}
      </div>

      <div className="video__bar">
        <button
          type="button"
          className="icon-btn"
          onClick={togglePlay}
          aria-label={playing ? 'Pause video' : 'Play video'}
        >
          {playing ? <Pause size={15} strokeWidth={1.75} /> : <Play size={15} strokeWidth={1.75} />}
        </button>

        <div className="range video__seek">
          <span className="range__track" aria-hidden="true" />
          <span className="range__fill" aria-hidden="true" style={{ width: `calc(6px + (100% - 12px) * ${fraction})` }} />
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={time}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Seek"
            aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}`}
          />
        </div>

        <span className="video__time">
          {formatTime(time)} / {formatTime(duration)}
        </span>

        <button
          type="button"
          className={`icon-btn video__sound${muted ? '' : ' is-on'}`}
          onClick={toggleSound}
          aria-pressed={!muted}
          aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
        >
          {muted ? (
            <VolumeX size={15} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Volume2 size={15} strokeWidth={1.75} aria-hidden="true" />
          )}
        </button>
      </div>

      <details className="video__transcript">
        <summary>Transcript</summary>
        {TRANSCRIPT.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </details>
    </div>
  );
}
