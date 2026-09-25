'use client';

import { useState } from 'react';
import Link from 'next/link';

export function RoiCalculator() {
  const [dailyCalls, setDailyCalls] = useState(25000);
  const [teamSize, setTeamSize] = useState(3);

  // Cloud LLM guardrail calculation: ~$0.003 per check, +850ms latency
  const monthlyCalls = dailyCalls * 30;
  const cloudLlmCost = Math.round((monthlyCalls * 0.003));
  const mastyfCost = 49 * teamSize;
  const monthlySavings = Math.max(0, cloudLlmCost - mastyfCost);

  // Latency calculation: 850ms vs 4.8µs
  const cloudHoursPerMonth = Math.round((monthlyCalls * 0.85) / 3600);
  const mastyfSecondsPerMonth = ((monthlyCalls * 0.0000048)).toFixed(1);

  return (
    <section className="lp-section lp-roi-section py-16" id="calculator" aria-label="Latency and ROI Calculator">
      <div className="lp-section-header">
        <span className="lp-pill lp-pill-gold">Deterministic Economics</span>
        <h2 className="lp-editorial-heading">Sub-Microsecond Latency. 98% Lower Cost.</h2>
        <p>
          Cloud LLM guardrails add 850ms of lag per tool call and cost thousands in API tokens. Mastyf executes locally in &lt;4.8µs for a flat $49/mo.
        </p>
      </div>

      <div className="card max-w-4xl mx-auto p-8 bg-[#070a12] border border-white/10 shadow-2xl rounded-2xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8 pb-8 border-b border-white/10">
          {/* Slider 1: Daily Calls */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label htmlFor="daily-calls-slider" className="text-xs font-semibold text-slate-300">
                Daily Agent Tool Calls
              </label>
              <span className="text-xs font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                {dailyCalls.toLocaleString()} calls / day
              </span>
            </div>
            <input
              id="daily-calls-slider"
              type="range"
              min="2000"
              max="200000"
              step="2000"
              value={dailyCalls}
              onChange={(e) => setDailyCalls(Number(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1">
              <span>2,000 / day</span>
              <span>100,000 / day</span>
              <span>200,000 / day</span>
            </div>
          </div>

          {/* Slider 2: Team Size */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label htmlFor="team-size-slider" className="text-xs font-semibold text-slate-300">
                Active Developer Seats
              </label>
              <span className="text-xs font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                {teamSize} {teamSize === 1 ? 'developer' : 'developers'}
              </span>
            </div>
            <input
              id="team-size-slider"
              type="range"
              min="1"
              max="15"
              step="1"
              value={teamSize}
              onChange={(e) => setTeamSize(Number(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1">
              <span>1 seat</span>
              <span>8 seats</span>
              <span>15 seats</span>
            </div>
          </div>
        </div>

        {/* Head-to-Head Comparison Matrix */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Cloud Guardrails Column */}
          <div className="p-5 rounded-xl bg-rose-950/20 border border-rose-500/20 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-rose-400 uppercase tracking-wider">
                  Cloud LLM Guardrails
                </span>
                <span className="text-[10px] font-mono text-rose-300 bg-rose-500/20 px-2 py-0.5 rounded">
                  OpenAI / Lakera / NeMo
                </span>
              </div>
              <div className="space-y-3 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Execution Latency:</span>
                  <span className="text-rose-400 font-bold">+850 ms / call</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Agent Idle Waiting Time:</span>
                  <span className="text-rose-400 font-bold">{cloudHoursPerMonth} hrs / month</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Data Privacy:</span>
                  <span className="text-slate-400">Prompts sent to 3rd party</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-rose-500/20">
                  <span className="text-slate-300 font-bold">Estimated Monthly Cost:</span>
                  <span className="text-rose-400 font-bold text-sm">${cloudLlmCost.toLocaleString()} / mo</span>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 mt-4 m-0">
              ⚠️ Incurs high variable API costs and breaks fail-closed when network connection drops.
            </p>
          </div>

          {/* Mastyf Shield Column */}
          <div className="p-5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col justify-between relative overflow-hidden">
            <div className="absolute top-0 right-0 w-28 h-28 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                  Mastyf Shield Sidecar
                </span>
                <span className="text-[10px] font-mono text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded font-bold">
                  Hardware-Grade Monitor
                </span>
              </div>
              <div className="space-y-3 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Execution Latency:</span>
                  <span className="text-emerald-400 font-bold">&lt; 4.8 µs (0.004 ms)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Agent Idle Waiting Time:</span>
                  <span className="text-emerald-400 font-bold">{mastyfSecondsPerMonth} sec total</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Data Privacy:</span>
                  <span className="text-emerald-400 font-bold">100% On-Device Local</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-amber-500/30">
                  <span className="text-slate-200 font-bold">Flat Subscription:</span>
                  <span className="text-amber-400 font-bold text-sm">${mastyfCost} / mo</span>
                </div>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-400 font-mono">
                💰 Save ~${monthlySavings.toLocaleString()} / mo
              </span>
              <Link
                href="/download"
                className="btn btn-primary btn-sm btn-pill text-xs font-bold shadow-md shadow-amber-500/20 px-3 py-1.5"
              >
                Download Mastyf Shield →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
