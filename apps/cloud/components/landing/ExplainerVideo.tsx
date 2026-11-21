'use client';

import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';

const SRC = '/media/mastyf-explainer.mp4';
const POSTER = '/media/mastyf-explainer-poster.jpg';

// Matches the captions burned into the video.
const TRANSCRIPT = [
  "AI agents don't just answer questions. They take actions: reading files, changing code, calling APIs. Mastyf decides which of those actions actually happen.",
  'An agent works in a loop. The model reads your request, chooses a tool, and that tool runs on your real systems: your files, your code, your data.',
  'Without a boundary, whatever the model proposes runs. If untrusted content steers the model off course, an action outside your policy executes as easily as a safe one. And nothing records why.',
  "With Mastyf in place, every tool call stops at the boundary first. It's checked against your policy: pattern rules, schema validation and an optional semantic review. Calls within policy pass straight through. Calls outside it are blocked before they ever reach the tool.",
  "Mastyf sits outside the model's reasoning loop. It doesn't ask the model to police itself, and it doesn't depend on any one vendor. Working at the tool-call layer, one policy protects agents built on any model, in any client. Change your model or framework, and your policy stays the same.",
  'Every decision is written to a tamper-evident audit log, so you can always show what your agent tried to do, and what was stopped.',
  'Your model proposes. Mastyf decides.',
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
          aria-label="Mastyf overview video, with burned-in captions"
        />
        {!started || ended ? (
          <button type="button" className="video__overlay" onClick={togglePlay}>
            <span>
              {ended ? (
                <RotateCcw size={15} strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <Play size={15} strokeWidth={1.75} aria-hidden="true" />
              )}
              {ended ? 'Watch again' : 'Play overview'}
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
          className={`btn btn-sm video__sound${muted ? '' : ' is-on'}`}
          onClick={toggleSound}
          aria-pressed={!muted}
        >
          {muted ? (
            <VolumeX size={14} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Volume2 size={14} strokeWidth={1.75} aria-hidden="true" />
          )}
          {muted ? 'Sound off' : 'Sound on'}
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
