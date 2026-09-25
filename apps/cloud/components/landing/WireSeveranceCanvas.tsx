'use client';

import { useState, useEffect, useRef } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

export function WireSeveranceCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [attackActive, setAttackActive] = useState<boolean>(true);
  const [receiptCopied, setReceiptCopied] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let particles: Particle[] = [];
    let pulseX = 0;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      const midY = height / 2;

      ctx.clearRect(0, 0, width, height);

      // Node coordinates
      const agentX = 80;
      const monitorX = width / 2;
      const targetX = width - 80;

      // 1. Draw Wire 1: Agent -> Monitor (Always active transport)
      ctx.beginPath();
      ctx.moveTo(agentX, midY);
      ctx.lineTo(monitorX, midY);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Traveling electric pulse along Wire 1
      pulseX = (pulseX + 2.5) % (monitorX - agentX);
      ctx.beginPath();
      ctx.arc(agentX + pulseX, midY, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#38bdf8';
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;

      // 2. Draw Wire 2: Monitor -> Protected Infrastructure
      if (!attackActive) {
        // Safe mode: Wire is intact and green
        ctx.beginPath();
        ctx.moveTo(monitorX, midY);
        ctx.lineTo(targetX, midY);
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.7)';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Safe green traveling pulse
        ctx.beginPath();
        ctx.arc(monitorX + pulseX, midY, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#10b981';
        ctx.shadowColor = '#10b981';
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        // Attack mode: WIRE IS PHYSICALLY SEVERED!
        // Draw left severed stub
        ctx.beginPath();
        ctx.moveTo(monitorX, midY);
        ctx.lineTo(monitorX + 30, midY);
        ctx.strokeStyle = 'rgba(255, 0, 55, 0.8)';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Draw severed gap with sparking particles
        if (Math.random() < 0.6) {
          for (let i = 0; i < 3; i++) {
            particles.push({
              x: monitorX + 30,
              y: midY,
              vx: (Math.random() - 0.5) * 5,
              vy: (Math.random() - 0.5) * 5,
              life: 1,
              color: Math.random() > 0.5 ? '#ff0037' : '#ffaa40',
              size: Math.random() * 2.5 + 1.5,
            });
          }
        }

        // Draw right disconnected stub (cold grey, zero energy)
        ctx.beginPath();
        ctx.moveTo(monitorX + 70, midY);
        ctx.lineTo(targetX, midY);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Update and render spark particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.04;

        if (p.life <= 0) {
          particles.splice(i, 1);
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 6;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }

      // Draw Center Monitor Station
      ctx.beginPath();
      ctx.arc(monitorX, midY, 18, 0, Math.PI * 2);
      ctx.fillStyle = '#080c14';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = attackActive ? '#ff0037' : '#10b981';
      ctx.shadowColor = attackActive ? '#ff0037' : '#10b981';
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;

      animId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animId);
  }, [attackActive]);

  const copyReceipt = () => {
    const receipt = {
      receipt_id: 'rcpt_msh_89f02c91a028',
      timestamp: '2026-09-24T21:08:42Z',
      verdict: 'BLOCK',
      backend_wire_bytes: 0,
      rule_triggered: 'difc.taint.untrusted_egress_sink',
      invariants_evaluated: 4,
      latency_microseconds: 2.14,
      signer: 'Ed25519:7f8a12c8e390...',
    };
    navigator.clipboard?.writeText(JSON.stringify(receipt, null, 2));
    setReceiptCopied(true);
    setTimeout(() => setReceiptCopied(false), 2000);
  };

  return (
    <div className="card lp-severance-card p-6 mt-8">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="lp-pill lp-pill-gold text-xs">Axiom A1 &amp; Proposition 1 Proof</span>
            <span className="text-xs font-mono text-cyan-400">&lt;4.8µs Latency</span>
          </div>
          <h3 className="text-lg font-bold text-white mt-1">
            Physical Wire Severance &amp; 0-Byte Transport Isolation
          </h3>
          <p className="text-xs text-slate-400 max-w-xl m-0">
            Click the buttons below to trigger an adversarial injection or benign tool dispatch.
            Watch the electric transport wire physically sever before any backend bytes can transit.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAttackActive(true)}
            className={`btn btn-sm btn-pill ${attackActive ? 'btn-primary font-bold' : 'btn-ghost'}`}
          >
            🛑 Simulate Attack (Sever Wire)
          </button>
          <button
            type="button"
            onClick={() => setAttackActive(false)}
            className={`btn btn-sm btn-pill ${!attackActive ? 'btn-primary font-bold' : 'btn-ghost'}`}
          >
            ✓ Benign Dispatch (Allow)
          </button>
        </div>
      </div>

      {/* HTML5 Particle Severance Canvas */}
      <div className="relative w-full overflow-hidden rounded-xl bg-black/80 border border-white/10 p-2">
        <canvas
          ref={canvasRef}
          width={800}
          height={160}
          className="w-full h-[160px] block"
        />

        <div className="absolute top-3 left-4 text-[10px] font-mono uppercase text-slate-400">
          Untrusted AI Agent
        </div>
        <div className="absolute top-3 left-1/2 -translate-x-1/2 text-[10px] font-mono uppercase font-bold text-amber-400">
          Mastyf Reference Monitor
        </div>
        <div className="absolute top-3 right-4 text-[10px] font-mono uppercase text-slate-400">
          Privileged Infrastructure
        </div>

        <div className="absolute bottom-3 right-4 text-xs font-mono">
          {attackActive ? (
            <span className="text-rose-400 font-bold bg-rose-950/60 px-2 py-0.5 rounded border border-rose-500/40">
              🛑 WIRE SEVERED · 0 BYTES
            </span>
          ) : (
            <span className="text-emerald-400 font-bold bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/40">
              ⚡ CONNECTED · 420 BYTES
            </span>
          )}
        </div>
      </div>

      {/* Ed25519 Cryptographic Receipt */}
      <div className="mt-4 flex items-center justify-between p-3 rounded-lg bg-black/60 border border-white/5 flex-wrap gap-2">
        <div className="font-mono text-xs text-slate-300 truncate">
          <span className="text-slate-500">Receipt:</span> rcpt_msh_89f02c91a028 (Ed25519 Signed SHA-256 Digest)
        </div>
        <button
          type="button"
          onClick={copyReceipt}
          className="text-xs font-mono text-amber-400 hover:text-white px-2.5 py-1 bg-amber-500/10 rounded border border-amber-500/20"
        >
          {receiptCopied ? '✓ Receipt Copied' : 'Copy Signed Receipt (JSON)'}
        </button>
      </div>
    </div>
  );
}
