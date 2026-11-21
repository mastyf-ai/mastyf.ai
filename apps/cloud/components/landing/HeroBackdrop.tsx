'use client';

import { useEffect, useRef } from 'react';

/**
 * Looping "boundary" animation behind the hero: tool calls stream toward Mastyf's
 * perimeter, unsafe ones are stopped at the ring, safe ones settle into the core.
 * Plays only while visible, never with reduced motion, and not on small screens.
 */
export function HeroBackdrop() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const small = window.matchMedia('(max-width: 767px)');

    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !reduced.matches && !small.matches) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    });
    io.observe(video);
    return () => io.disconnect();
  }, []);

  return (
    <video
      ref={videoRef}
      className="hero__bg"
      poster="/media/hero-boundary-poster.jpg"
      muted
      loop
      playsInline
      preload="none"
      aria-hidden="true"
      tabIndex={-1}
    >
      <source src="/media/hero-boundary.webm" type="video/webm" />
      <source src="/media/hero-boundary.mp4" type="video/mp4" />
    </video>
  );
}
