/** Public files of the static export are served by the dashboard server under /dashboard-spa/. */
export const PUBLIC_BASE = '/dashboard-spa';

type Props = {
  size?: number;
  className?: string;
  /** Show the "mastyf" wordmark next to the mark. */
  wordmark?: boolean;
};

/**
 * The Mastyf mark (the dog with the gold check), the same artwork as mastyf.ai and the Shield app.
 * It is light line art: drawn as-is on dark, inverted with hues kept on light (see .brand-mark).
 */
export function BrandLogo({ size = 28, className = '', wordmark = false }: Props) {
  return (
    <span className={`brand ${className}`.trim()}>
      <img
        src={`${PUBLIC_BASE}/brand/mark-128.png`}
        alt={wordmark ? '' : 'Mastyf'}
        width={size}
        height={size}
        className="brand-mark"
      />
      {wordmark && <span className="brand-word">mastyf</span>}
    </span>
  );
}
