'use client';

import { useEffect, useRef } from 'react';

export function ConcentricRadar() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let angle = 0;

    const blips = [
      { x: 0.3, y: 0.4, type: 'safe', label: 'Claude (Local)' },
      { x: 0.7, y: 0.3, type: 'threat', label: 'Injected Prompt (Blocked)' },
      { x: 0.6, y: 0.75, type: 'safe', label: 'Cursor (Workspace)' },
      { x: 0.25, y: 0.8, type: 'threat', label: 'Path Traversal (Blocked)' },
      { x: 0.8, y: 0.6, type: 'safe', label: 'LangGraph Worker' },
    ];

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(cx, cy) - 20;

      ctx.clearRect(0, 0, width, height);

      // 1. Draw Concentric Radar Rings
      ctx.lineWidth = 1;
      for (let r = radius / 4; r <= radius; r += radius / 4) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
        ctx.stroke();
      }

      // 2. Crosshair grid lines
      ctx.beginPath();
      ctx.moveTo(cx - radius, cy);
      ctx.lineTo(cx + radius, cy);
      ctx.moveTo(cx, cy - radius);
      ctx.lineTo(cx, cy + radius);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.1)';
      ctx.stroke();

      // 3. Rotating Radar Sweep Beam
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);

      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      grad.addColorStop(0, 'rgba(56, 189, 248, 0.4)');
      grad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, 0, Math.PI / 4);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Sweep front edge line
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(radius * Math.cos(Math.PI / 4), radius * Math.sin(Math.PI / 4));
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // 4. Draw Radar Blips with Glowing Rings
      blips.forEach((blip) => {
        const bx = (blip.x - 0.5) * 2 * radius * 0.85 + cx;
        const by = (blip.y - 0.5) * 2 * radius * 0.85 + cy;

        ctx.beginPath();
        ctx.arc(bx, by, 4, 0, Math.PI * 2);
        if (blip.type === 'threat') {
          ctx.fillStyle = '#ff0037';
          ctx.shadowColor = '#ff0037';
          ctx.shadowBlur = 10;
        } else {
          ctx.fillStyle = '#10b981';
          ctx.shadowColor = '#10b981';
          ctx.shadowBlur = 8;
        }
        ctx.fill();
        ctx.shadowBlur = 0;

        // Label
        ctx.fillStyle = blip.type === 'threat' ? '#fda4af' : '#94a3b8';
        ctx.font = '10px monospace';
        ctx.fillText(blip.label, bx + 8, by + 3);
      });

      angle += 0.02;
      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  return (
    <div className="lp-radar-wrapper flex flex-col items-center justify-center p-4">
      <div className="flex items-center justify-between w-full mb-3 px-2">
        <div className="flex items-center gap-2">
          <span className="demo-live-dot" />
          <span className="text-xs font-mono font-bold text-slate-300 uppercase">
            Federated Agent Perimeter Radar
          </span>
        </div>
        <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-500/30">
          360° ACTIVE SWEEP
        </span>
      </div>

      <div className="relative">
        <canvas
          ref={canvasRef}
          width={360}
          height={320}
          className="rounded-full bg-black/60 border border-cyan-500/20 shadow-2xl shadow-cyan-500/10"
        />
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-mono text-slate-500 bg-black/80 px-2 py-0.5 rounded border border-white/5">
          Fast-Path Intercept: &lt;4.8 µs
        </div>
      </div>
    </div>
  );
}
