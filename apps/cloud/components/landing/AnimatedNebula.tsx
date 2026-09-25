'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * AnimatedNebula — replaces DynamicBackground
 *
 * Layers (back → front):
 *   1. Deep radial void gradient (CSS only, instant)
 *   2. Three slow-drifting nebula orbs (CSS animation)
 *   3. SVG noise grain overlay
 *   4. Interactive dot grid (canvas + mouse parallax)
 *   5. Cursor spotlight that radiates from the pointer
 */
export function AnimatedNebula() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mounted, setMounted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Track cursor for spotlight via CSS custom props
  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Cursor position → CSS vars for spotlight
  useEffect(() => {
    if (!mounted || reducedMotion) return;
    const onMove = (e: MouseEvent) => {
      document.documentElement.style.setProperty('--nebula-cx', `${e.clientX}px`);
      document.documentElement.style.setProperty('--nebula-cy', `${e.clientY}px`);
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, [mounted, reducedMotion]);

  // Dot grid canvas with mouse parallax
  useEffect(() => {
    if (!mounted || reducedMotion) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let mx = 0;
    let my = 0;

    const draw = () => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.13)';
      const step = 38;
      const offX = mx * 0.025;
      const offY = my * 0.025;
      for (let x = 0; x < width + step; x += step) {
        for (let y = 0; y < height + step; y += step) {
          ctx.beginPath();
          ctx.arc((x + offX) % width, (y + offY) % height, 1.1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = Math.max(window.innerHeight * 2, 1800);
      draw();
    };

    const onMove = (e: MouseEvent) => {
      mx = e.clientX - window.innerWidth / 2;
      my = e.clientY - window.innerHeight / 2;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(raf);
    };
  }, [mounted, reducedMotion]);

  return (
    <div className="nebula-root" aria-hidden="true">
      {/* Layer 1: Radial void gradient — always visible, no JS */}
      <div className="nebula-void" />

      {/* Layer 2: Drifting nebula orbs */}
      {!reducedMotion && (
        <>
          <div className="nebula-orb nebula-orb-gold" />
          <div className="nebula-orb nebula-orb-cerulean" />
          <div className="nebula-orb nebula-orb-violet" />
        </>
      )}

      {/* Layer 3: SVG noise grain */}
      <div className="nebula-grain" />

      {/* Layer 4: Interactive dot grid */}
      {mounted && !reducedMotion ? (
        <canvas ref={canvasRef} className="nebula-grid" />
      ) : (
        <div className="nebula-grid-static" />
      )}

      {/* Layer 5: Cursor spotlight */}
      {mounted && !reducedMotion && (
        <div className="nebula-spotlight" />
      )}
    </div>
  );
}
