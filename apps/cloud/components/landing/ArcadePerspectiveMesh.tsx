'use client';

export function ArcadePerspectiveMesh() {
  return (
    <div className="lp-arcade-perspective-mesh" aria-hidden="true">
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 2673 1737"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="lp-arcade-svg-grid"
      >
        <defs>
          <linearGradient id="arcade-grid-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.08" />
            <stop offset="40%" stopColor="#fbbf24" stopOpacity="0.18" />
            <stop offset="70%" stopColor="#c3ff00" stopOpacity="0.07" />
            <stop offset="100%" stopColor="#ff20bc" stopOpacity="0.12" />
          </linearGradient>
          <radialGradient id="arcade-center-glow" cx="50%" cy="40%" r="50%">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.22" />
            <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.07" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="2673" height="1737" fill="url(#arcade-center-glow)" />

        <g stroke="url(#arcade-grid-grad)" strokeWidth="1.2">
          {/* Vertical converging perspective lines */}
          <path d="M1336.38 -1306.28V3140.72" />
          <path d="M2703 -1272.28L-30 3008.72" />
          <path d="M3330 -471.284L-657 2207.72" />
          <path d="M3333 134.716L-660 1601.72" />
          <path d="M3337 590.716L-664 1145.72" />
          <path d="M-667 590.716L3340 1145.72" />
          <path d="M-661 134.716L3334 1601.72" />
          <path d="M-658 -471.284L3330 2207.72" />
          <path d="M-30 -1272.28L2703 3008.72" />

          {/* Horizontal perspective depth rungs */}
          <path d="M3333.5 867.979H-668" />
          <path d="M3336 1030.72H-664" />
          <path d="M3336 1301.72H-664" />
          <path d="M3336 704.716L-664 704.716" />
          <path d="M3336 434.716L-664 434.716" />
        </g>
      </svg>
    </div>
  );
}
