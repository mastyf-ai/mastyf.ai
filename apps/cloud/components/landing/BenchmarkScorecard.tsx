'use client';

import { useEffect, useRef, useState } from 'react';

interface BenchmarkStat {
  id: string;
  label: string;
  sublabel: string;
  value: number;
  display: string;
  suffix: string;
  accentColor: string;
  description: string;
  badge: string;
}

const BENCHMARKS: BenchmarkStat[] = [
  {
    id: 'agentdojo',
    label: 'AgentDojo',
    sublabel: 'Attack Defense Rate',
    value: 99.52,
    display: '99.52',
    suffix: '%',
    accentColor: '#10b981',
    description: '629 adversarial episodes · Exact clean utility parity · No false positives',
    badge: 'Independent Benchmark',
  },
  {
    id: 'injecagent',
    label: 'InjecAgent',
    sublabel: 'Indirect Tool Injection',
    value: 100,
    display: '100',
    suffix: '%',
    accentColor: '#22d3ee',
    description: '4,216 multi-turn jailbreak vectors · Tool-level interception · Zero bypass',
    badge: 'Open Evaluation',
  },
  {
    id: 'throughput',
    label: 'Throughput',
    sublabel: 'Requests / Second',
    value: 330,
    display: '>330k',
    suffix: '',
    accentColor: '#f59e0b',
    description: 'Fast-path gateway · <4.8µs per call overhead · Zero memory leaks',
    badge: 'Verified Performance',
  },
];

function useCountUp(target: number, duration = 1400) {
  const [count, setCount] = useState(0);
  const [started, setStarted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started) {
          setStarted(true);
        }
      },
      { threshold: 0.4 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;
    const start = performance.now();
    const raf = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * target));
      if (progress < 1) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
  }, [started, target, duration]);

  return { count, ref };
}

function BenchmarkCard({ stat }: { stat: BenchmarkStat }) {
  const { count, ref } = useCountUp(stat.value, 1600);

  return (
    <div className="lp-benchmark-card" ref={ref} style={{ '--bench-accent': stat.accentColor } as React.CSSProperties}>
      <div className="lp-benchmark-top-accent" />
      <div className="lp-benchmark-badge">{stat.badge}</div>
      <div className="lp-benchmark-label">{stat.label}</div>
      <div className="lp-benchmark-sublabel">{stat.sublabel}</div>
      <div className="lp-benchmark-value">
        {/* Show full display string for >330k, otherwise animate */}
        {stat.display.startsWith('>') ? (
          <span className="lp-bench-num">{stat.display}</span>
        ) : (
          <span className="lp-bench-num">
            {count === stat.value ? stat.display : count.toFixed(stat.suffix === '%' && stat.value < 100 ? 0 : 0)}
          </span>
        )}
        <span className="lp-bench-suffix">{stat.suffix}</span>
      </div>
      <p className="lp-benchmark-desc">{stat.description}</p>
    </div>
  );
}

export function BenchmarkScorecard() {
  return (
    <section className="lp-section" id="benchmarks" aria-label="Third-party benchmark results">
      <div className="lp-section-header">
        <span className="lp-pill lp-pill-gold">Independent Verification</span>
        <h2>Proven by Third-Party Benchmarks</h2>
        <p>
          Not self-reported marketing claims — verified across standardized adversarial evaluation suites
          and peer-reviewed in a published formal monograph.
        </p>
      </div>

      <div className="lp-benchmark-grid">
        {BENCHMARKS.map((stat) => (
          <BenchmarkCard key={stat.id} stat={stat} />
        ))}
      </div>

      <div className="lp-benchmark-doi">
        <span className="lp-benchmark-doi-icon">📄</span>
        <span>Peer-reviewed ·</span>
        <a
          href="https://zenodo.org/records/22501491"
          target="_blank"
          rel="noopener noreferrer"
          className="lp-benchmark-doi-link"
        >
          DOI 10.5281/zenodo.22501491
        </a>
        <span>· CC-BY 4.0 · Formal verification proofs included</span>
      </div>
    </section>
  );
}
