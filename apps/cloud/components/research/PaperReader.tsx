'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, Minus, Plus } from 'lucide-react';

const PAGE_COUNT = 42;
const PDF_URL = '/paper/mastyf-guard.pdf';
/** Page images rendered from the PDF (1400px wide, 612×792pt pages). */
const pageSrc = (n: number) => `/paper/pages/page-${String(n).padStart(2, '0')}.webp`;
const ZOOMS = [100, 125, 150] as const;

/**
 * A scrollable window onto the paper itself. The site forbids framing (X-Frame-Options:
 * DENY), so the pages are pre-rendered images; the PDF stays one click away for search
 * and text selection.
 */
export function PaperReader() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(100);

  // The page counter follows whichever page fills most of the window.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const ratios = new Map<number, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          ratios.set(Number((entry.target as HTMLElement).dataset.page), entry.intersectionRatio);
        }
        let best = 1;
        let bestRatio = -1;
        ratios.forEach((ratio, n) => {
          if (ratio > bestRatio) {
            best = n;
            bestRatio = ratio;
          }
        });
        setPage(best);
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    root.querySelectorAll('[data-page]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const zoomIndex = ZOOMS.indexOf(zoom);
  const stepZoom = (delta: number) => {
    const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, zoomIndex + delta))];
    setZoom(next);
  };

  return (
    <div className="reader">
      <div className="reader__bar">
        <span className="reader__file">mastyf-guard.pdf</span>
        <span className="reader__count" aria-live="polite">
          Page {page} of {PAGE_COUNT}
        </span>
        <div className="reader__tools">
          <button
            type="button"
            className="icon-btn"
            onClick={() => stepZoom(-1)}
            disabled={zoomIndex === 0}
            aria-label="Zoom out"
          >
            <Minus size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <span className="reader__zoom">{zoom}%</span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => stepZoom(1)}
            disabled={zoomIndex === ZOOMS.length - 1}
            aria-label="Zoom in"
          >
            <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <a href={PDF_URL} target="_blank" rel="noopener noreferrer" className="icon-btn" aria-label="Open the PDF in a new tab">
            <ExternalLink size={15} strokeWidth={1.75} aria-hidden="true" />
          </a>
          <a href={PDF_URL} download className="icon-btn" aria-label="Download the PDF">
            <Download size={15} strokeWidth={1.75} aria-hidden="true" />
          </a>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="reader__scroll"
        data-lenis-prevent
        tabIndex={0}
        role="region"
        aria-label={`The paper, ${PAGE_COUNT} pages`}
        style={{ ['--reader-zoom' as string]: zoom / 100 }}
      >
        {Array.from({ length: PAGE_COUNT }, (_, i) => i + 1).map((n) => (
          <div key={n} className="reader__page" data-page={n}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pageSrc(n)}
              alt={`Page ${n} of the paper`}
              width={1400}
              height={1812}
              loading={n <= 2 ? 'eager' : 'lazy'}
              decoding="async"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
