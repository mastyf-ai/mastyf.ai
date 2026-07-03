'use client';

import { useEffect, useRef, useState } from 'react';

export function DynamicBackground() {
  const meshRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

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
      ctx.fillStyle = 'rgba(10, 17, 40, 0.055)';
      const step = 24;
      for (let x = 0; x < width; x += step) {
        for (let y = 0; y < height; y += step) {
          ctx.beginPath();
          ctx.arc(x + mx * 0.002, y + my * 0.002, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      draw();
    };

    const onMove = (e: MouseEvent) => {
      mx = e.clientX - window.innerWidth / 2;
      my = e.clientY - window.innerHeight / 2;
      if (meshRef.current) {
        meshRef.current.style.transform = `translate(${mx * 0.015}px, ${my * 0.015}px)`;
      }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(raf);
    };
  }, [mounted, reducedMotion]);

  return (
    <div className="lp-dynamic-bg" aria-hidden>
      <div
        ref={meshRef}
        className={`lp-dynamic-mesh${reducedMotion ? ' lp-dynamic-mesh-static' : ''}`}
      />
      {mounted && !reducedMotion ? (
        <canvas ref={canvasRef} className="lp-dynamic-grid" />
      ) : (
        <div className="lp-dynamic-grid-fallback" />
      )}
    </div>
  );
}
