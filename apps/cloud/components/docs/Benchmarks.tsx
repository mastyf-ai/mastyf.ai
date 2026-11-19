'use client';

import { useEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { PAPER_VERSION, ZENODO_DOI, ZENODO_URL } from '@/lib/product-links';

interface BenchmarkStat {
  id: string;
  label: string;
  sublabel: string;
  value: number;
  display: string;
  suffix: string;
  description: string;
  badge: string;
}

const BENCHMARKS: BenchmarkStat[] = [
  {
    id: 'agentdojo',
    label: 'AgentDojo',
    sublabel: 'Attack defense rate',
    value: 99.52,
    display: '99.52',
    suffix: '%',
    description: '629 adversarial episodes, clean task utility matching the unprotected baseline',
    badge: 'Paper result',
  },
  {
    id: 'injecagent',
    label: 'InjecAgent',
    sublabel: 'Indirect tool injection',
    value: 98.43,
    display: '98.43',
    suffix: '%',
    description: '4,216 indirect-injection cases, intercepted at the tool call',
    badge: 'Paper result',
  },
  {
    id: 'throughput',
    label: 'Rule check',
    sublabel: 'Median time per call',
    value: 1.5,
    display: '~1.5',
    suffix: ' ms',
    description: 'One call at a time on a laptop CPU; about 5 ms at the 95th percentile. Protocol X takes about 1 s.',
    badge: 'Measured',
  },
];

// Renders the final value by default so it is correct without JS or when already
// on screen; only re-arms from zero when the row starts below the fold.
function useCountUp(target: number, duration = 1400) {
  const [count, setCount] = useState(target);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return;

    setCount(0);
    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const progress = Math.min((now - start) / duration, 1);
          // Ease-out cubic
          const eased = 1 - Math.pow(1 - progress, 3);
          setCount(progress < 1 ? Math.floor(eased * target) : target);
          if (progress < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.4 }
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [target, duration]);

  return { count, ref };
}

function BenchmarkCard({ stat }: { stat: BenchmarkStat }) {
  const { count, ref } = useCountUp(stat.value, 1600);
  const settled = stat.display.startsWith('>') || count === stat.value;

  return (
    <div className="bench__item" ref={ref}>
      <div className="bench__head">
        <span>{stat.label}</span>
        <span className="bench__badge">{stat.badge}</span>
      </div>
      <div className="bench__value">
        <span>{settled ? stat.display : count.toFixed(0)}</span>
        {stat.suffix ? <span className="bench__suffix">{stat.suffix}</span> : null}
      </div>
      <div className="bench__sub">{stat.sublabel}</div>
      <p className="bench__desc">{stat.description}</p>
    </div>
  );
}

export function Benchmarks() {
  return (
    <>
      <div className="bench">
        {BENCHMARKS.map((stat) => (
          <BenchmarkCard key={stat.id} stat={stat} />
        ))}
      </div>

      <p className="bench__doi">
        <FileText size={13} strokeWidth={1.75} aria-hidden="true" />
        Open-access preprint, {PAPER_VERSION}.
        <a href={ZENODO_URL} target="_blank" rel="noopener noreferrer">
          DOI {ZENODO_DOI}
        </a>
        <span>CC-BY 4.0, proofs and evaluation methodology included.</span>
      </p>
    </>
  );
}
