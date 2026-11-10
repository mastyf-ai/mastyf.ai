'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';

/**
 * A detailed, front-facing robo-dog head (the Mastyf logo dog, looking at you).
 * Its eyes follow the cursor, it blinks, twitches an ear now and then, and gives a
 * silent howl at times. Idle life only runs while `active`.
 */

const MIRROR = 'matrix(-1 0 0 1 120 0)';
const SOCKET = 'M37.5 52 C40 47.5 51 47.5 54.5 52 C55 58 51 61.5 46 61.5 C41 61.5 37 58 37.5 52 Z';
// Howl waves rise above the antenna; they sit partly outside the viewBox (the svg overflows).
const ARCS = ['M45 3 Q60 -5 75 3', 'M38 -2 Q60 -13 82 -2', 'M31 -7 Q60 -21 89 -7'];

type HalfRefs = {
  ear: (el: SVGGElement | null) => void;
  brow: (el: SVGPathElement | null) => void;
  eye: (el: SVGGElement | null) => void;
  lid: (el: SVGPathElement | null) => void;
};

/** The left half of the face; the right half is the same drawing, mirrored. */
function Half({ refs }: { refs: HalfRefs }) {
  return (
    <>
      <g ref={refs.ear}>
        <path className="df-shell" d="M34 54 L24 12 C24.5 9 27 8.5 29 10.5 L52 34 Z" />
        <path className="df-inner" d="M35 46 L29 19 L46 35 Z" />
        <circle className="df-rivet" cx={33.2} cy={44} r={1.1} />
        <circle className="df-rivet" cx={30.2} cy={26} r={0.9} />
      </g>
      {/* furry ruff along the cheek */}
      <path
        className="df-ruff"
        d="M28 54 L21.5 59.5 L28 62 L20.5 68 L28 70.5 L22.5 77 L31 78.5 L26.5 85 L35 85.5 L33 92 L42 90 L44 88 C36 82 30 74 28 64 Z"
      />
    </>
  );
}

/** Features drawn on top of the head shell, left half. */
function HalfFace({ refs }: { refs: HalfRefs }) {
  return (
    <>
      <path className="df-panel" d="M29 62 C30 71 34 78 40 83 L46 75 C41 70 38 64 37 57 Z" />
      <path className="df-vent" d="M32 66 L36 67.5" />
      <path className="df-vent" d="M33 69.5 L37 71" />
      <path className="df-vent" d="M34.5 73 L38.5 74.5" />
      <circle className="df-bolt" cx={35} cy={60} r={1.2} />
      <path className="df-brow" ref={refs.brow} d="M38 47 Q45 42.5 53 46" />
      <path className="df-socket" d={SOCKET} />
      <g clipPath="url(#df-socket-clip)">
        <circle className="df-glow" cx={46} cy={55} r={5.8} />
        <g ref={refs.eye}>
          <circle className="df-iris" cx={46} cy={55} r={4.4} />
          <circle className="df-iris-ring" cx={46} cy={55} r={3} />
          <ellipse className="df-pupil" cx={46} cy={55} rx={1.25} ry={2.5} />
          <circle className="df-shine" cx={44.3} cy={53.2} r={1.1} />
          <circle className="df-shine df-shine--small" cx={47.6} cy={57} r={0.5} />
        </g>
        <path className="df-lid" ref={refs.lid} d={SOCKET} transform="translate(0 48) scale(1 0.001) translate(0 -48)" />
      </g>
      <path className="df-whisker" d="M45 76 L33 74.5" />
      <path className="df-whisker" d="M45 79 L34 80.5" />
      <circle className="df-pore" cx={51} cy={73} r={0.7} />
      <circle className="df-pore" cx={49} cy={75.5} r={0.7} />
      <circle className="df-pore" cx={52} cy={77.2} r={0.7} />
    </>
  );
}

export function DogFace({ active }: { active: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const headRef = useRef<SVGGElement>(null);
  const jawRef = useRef<SVGPathElement>(null);
  const mouthRef = useRef<SVGEllipseElement>(null);
  const ears = useRef<(SVGGElement | null)[]>([]);
  const brows = useRef<(SVGPathElement | null)[]>([]);
  const eyes = useRef<(SVGGElement | null)[]>([]);
  const lids = useRef<(SVGPathElement | null)[]>([]);
  const arcs = useRef<(SVGPathElement | null)[]>([]);

  const half = (i: number): HalfRefs => ({
    ear: (el) => { ears.current[i] = el; },
    brow: (el) => { brows.current[i] = el; },
    eye: (el) => { eyes.current[i] = el; },
    lid: (el) => { lids.current[i] = el; },
  });

  useEffect(() => {
    if (!active) return;
    const svg = svgRef.current;
    if (!svg) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pose = { tilt: 0, lift: 0, brow: 0, lid: 0, mouth: 0, arcs: 0, earL: 0, earR: 0 };
    // It looks straight at you; a moving cursor earns a glance, then its eyes come back.
    const look = { x: 0, y: 0, tx: 0, ty: 0, at: 0 };
    let howling: gsap.core.Timeline | null = null;
    let frame = 0;

    const apply = () => {
      if (performance.now() - look.at > 1400) {
        look.tx = 0;
        look.ty = 0;
      }
      look.x += (look.tx - look.x) * 0.15;
      look.y += (look.ty - look.y) * 0.15;
      headRef.current?.setAttribute('transform', `translate(0 ${(-pose.lift).toFixed(2)}) rotate(${pose.tilt.toFixed(2)} 60 92)`);
      // The right half is mirrored, so its horizontal offset flips.
      eyes.current[0]?.setAttribute('transform', `translate(${look.x.toFixed(2)} ${look.y.toFixed(2)})`);
      eyes.current[1]?.setAttribute('transform', `translate(${(-look.x).toFixed(2)} ${look.y.toFixed(2)})`);
      const lid = Math.max(0.001, pose.lid);
      lids.current.forEach((el) => el?.setAttribute('transform', `translate(0 48) scale(1 ${lid.toFixed(3)}) translate(0 -48)`));
      brows.current.forEach((el) => el?.setAttribute('transform', `translate(0 ${(-pose.brow).toFixed(2)})`));
      ears.current[0]?.setAttribute('transform', `rotate(${pose.earL.toFixed(2)} 42 44)`);
      ears.current[1]?.setAttribute('transform', `rotate(${pose.earR.toFixed(2)} 42 44)`);
      jawRef.current?.setAttribute('transform', `translate(0 ${(pose.mouth * 0.55).toFixed(2)})`);
      mouthRef.current?.setAttribute('ry', Math.max(0.01, pose.mouth).toFixed(2));
      mouthRef.current?.setAttribute('opacity', Math.min(1, pose.mouth / 1.5).toFixed(2));
      arcs.current.forEach((el, i) => {
        const w = pose.arcs * (ARCS.length + 1) - i;
        el?.setAttribute('opacity', (w > 0 && w < 1.6 ? Math.sin((Math.PI * w) / 1.6) : 0).toFixed(3));
      });
      frame = requestAnimationFrame(apply);
    };
    frame = requestAnimationFrame(apply);

    const onPointer = (event: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      const dx = event.clientX - (r.left + r.width / 2);
      const dy = event.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 240) * 1.4;
      look.tx = (dx / d) * k;
      look.ty = (dy / d) * k * 0.8;
      look.at = performance.now();
    };
    window.addEventListener('pointermove', onPointer, { passive: true });

    const howl = () => {
      howling = gsap
        .timeline({ onComplete: () => { howling = null; } })
        .to(pose, { tilt: -9, lift: 3, brow: 2.6, duration: 0.4, ease: 'power2.out' })
        .to(pose, { lid: 0.9, duration: 0.18 }, '<0.15')
        .to(pose, { mouth: 6.5, duration: 0.3, ease: 'power2.out' }, '<')
        .to(pose, { arcs: 1, duration: 1.6, ease: 'none' }, '<0.1')
        .to(pose, { tilt: 0, lift: 0, brow: 0, lid: 0, mouth: 0, duration: 0.45, ease: 'power2.inOut' })
        .set(pose, { arcs: 0 });
    };
    const blink = () => {
      if (howling) return;
      gsap.timeline().to(pose, { lid: 1, duration: 0.07 }).to(pose, { lid: 0, duration: 0.11 });
    };
    const twitch = () => {
      const key = Math.random() < 0.5 ? 'earL' : 'earR';
      gsap.timeline().to(pose, { [key]: -9, duration: 0.1 }).to(pose, { [key]: 3, duration: 0.08 }).to(pose, { [key]: 0, duration: 0.18 });
    };

    const timers: number[] = [];
    if (!reduced) {
      const loop = (fn: () => void, min: number, max: number) => {
        const run = () => {
          fn();
          timers.push(window.setTimeout(run, min + Math.random() * (max - min)));
        };
        timers.push(window.setTimeout(run, min + Math.random() * (max - min)));
      };
      loop(blink, 2400, 5200);
      loop(twitch, 4000, 9000);
      loop(() => { if (!howling) howl(); }, 7000, 13000);
      // A first howl shortly after appearing.
      timers.push(window.setTimeout(() => { if (!howling) howl(); }, 1600));
    }

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onPointer);
      timers.forEach((t) => window.clearTimeout(t));
      howling?.kill();
      gsap.killTweensOf(pose);
    };
  }, [active]);

  return (
    <svg ref={svgRef} className="dogface" viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <clipPath id="df-socket-clip">
          <path d={SOCKET} />
        </clipPath>
        <linearGradient id="df-metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="df-stop-metal-0" />
          <stop offset="0.55" className="df-stop-metal-1" />
          <stop offset="1" className="df-stop-metal-2" />
        </linearGradient>
        <linearGradient id="df-metal-light" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="df-stop-plate-0" />
          <stop offset="1" className="df-stop-plate-1" />
        </linearGradient>
        <radialGradient id="df-iris-fill" cx="0.42" cy="0.38" r="0.7">
          <stop offset="0" stopColor="#fff1c4" />
          <stop offset="0.45" stopColor="#e5cb6c" />
          <stop offset="1" stopColor="#8a5f1c" />
        </radialGradient>
        <radialGradient id="df-nose-fill" cx="0.4" cy="0.3" r="0.8">
          <stop offset="0" className="df-stop-nose-0" />
          <stop offset="1" className="df-stop-nose-1" />
        </radialGradient>
      </defs>
      <g ref={headRef}>
        {/* antenna */}
        <line className="df-antenna" x1={60} y1={22} x2={60} y2={10.5} />
        <circle className="df-antenna-glow" cx={60} cy={8.5} r={5} />
        <circle className="df-antenna-tip" cx={60} cy={8.5} r={2.6} />

        <Half refs={half(0)} />
        <g transform={MIRROR}>
          <Half refs={half(1)} />
        </g>

        {/* head shell */}
        <path
          className="df-shell df-shell--head"
          d="M60 21 C80 21 93 33 95 50 C96.5 63 92 75 84 83 C78 89 70 93 60 93 C50 93 42 89 36 83 C28 75 23.5 63 25 50 C27 33 40 21 60 21 Z"
        />
        {/* forehead plate */}
        <path className="df-plate" d="M60 25 C70 25 78 30 81.5 37.5 L74 45.5 L60 48.5 L46 45.5 L38.5 37.5 C42 30 50 25 60 25 Z" />
        <path className="df-sheen" d="M42 28.5 Q60 21.5 78 28.5" />
        <path className="df-seam" d="M60 26 L60 48" />
        <circle className="df-rivet" cx={44} cy={36} r={0.9} />
        <circle className="df-rivet" cx={76} cy={36} r={0.9} />
        <circle className="df-status" cx={60} cy={32.5} r={1.5} />

        <HalfFace refs={half(0)} />
        <g transform={MIRROR}>
          <HalfFace refs={half(1)} />
        </g>

        <path className="df-seam" d="M60 49 L60 63" />
        {/* muzzle */}
        <path className="df-muzzle" d="M44 65 C48 61 72 61 76 65 C79.5 71 78.5 79.5 72.5 84 C68 87.5 52 87.5 47.5 84 C41.5 79.5 40.5 71 44 65 Z" />
        <ellipse className="df-mouth" ref={mouthRef} cx={60} cy={80.5} rx={4.6} ry={0.01} opacity={0} />
        <path className="df-nose" d="M52.5 65.5 C55 62.8 65 62.8 67.5 65.5 C68 68.8 64.2 71.6 60 71.6 C55.8 71.6 52 68.8 52.5 65.5 Z" />
        <ellipse className="df-nose-shine" cx={57} cy={65.6} rx={2.4} ry={1} />
        <ellipse className="df-nostril" cx={56.6} cy={68.3} rx={1.3} ry={0.8} />
        <ellipse className="df-nostril" cx={63.4} cy={68.3} rx={1.3} ry={0.8} />
        <path className="df-line" d="M60 71.6 L60 75.5" />
        <path className="df-lip" d="M49.5 75.5 Q55 79.5 60 75.5 Q65 79.5 70.5 75.5" />
        <path className="df-jaw" ref={jawRef} d="M51 79 Q60 88.5 69 79" />

        {/* collar with the logo's shield tag */}
        <path className="df-shell" d="M38 90 Q60 101 82 90 L84.5 97 Q60 109.5 35.5 97 Z" />
        {[45, 52, 68, 75].map((x, i) => (
          <circle key={x} className="df-stud" cx={x} cy={i === 0 || i === 3 ? 97.5 : 100.5} r={1} />
        ))}
        <path className="df-tag" d="M54.5 99 Q60 96 65.5 99 L65.5 104.5 Q65.5 109 60 111.5 Q54.5 109 54.5 104.5 Z" />
        <path className="df-check" d="M57.2 104 L59.4 106.2 L63.2 101.8" />
      </g>

      {/* silent howl */}
      {ARCS.map((d, i) => (
        <path key={d} className="df-arc" ref={(el) => { arcs.current[i] = el; }} d={d} opacity={0} />
      ))}
    </svg>
  );
}
