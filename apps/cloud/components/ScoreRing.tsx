type Props = {
  score: number;
  grade: string;
  size?: number;
};

/** Gold for good grades, a deeper gold for C, bronze for D and F. Same scale as the directory pills. */
function tone(grade: string): 'gold' | 'mid' | 'bronze' {
  if (grade === 'C') return 'mid';
  if (grade === 'D' || grade === 'F') return 'bronze';
  return 'gold';
}

/**
 * The score as a thin gold arc that draws itself in once, with the number in the middle.
 * The grade is spoken in the label and shown as text by the page, not as a coloured disc.
 */
export function ScoreRing({ score, grade, size = 200 }: Props) {
  const stroke = 6;
  const radius = (size - stroke) / 2 - 4;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, score)) / 100) * circumference;
  const c = size / 2;

  return (
    <div
      className="pkg-ring"
      data-tone={tone(grade)}
      style={{ width: size, height: size, ['--ring-c' as string]: circumference, ['--ring-off' as string]: offset }}
      role="img"
      aria-label={`Score ${score} out of 100, grade ${grade}`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id="pkg-ring-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" className="pkg-ring__stop-hi" />
            <stop offset="55%" className="pkg-ring__stop-mid" />
            <stop offset="100%" className="pkg-ring__stop-lo" />
          </linearGradient>
        </defs>
        <circle className="pkg-ring__track" cx={c} cy={c} r={radius} fill="none" strokeWidth={stroke} />
        <circle
          className="pkg-ring__arc"
          cx={c}
          cy={c}
          r={radius}
          fill="none"
          stroke="url(#pkg-ring-gold)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${c} ${c})`}
        />
      </svg>
      <span className="pkg-ring__value">
        <span className="pkg-ring__num">{score}</span>
        <span className="pkg-ring__of">out of 100</span>
      </span>
    </div>
  );
}
