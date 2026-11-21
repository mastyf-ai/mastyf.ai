import { trustGradeColor } from '@/lib/trust-badge-grade';

type Props = {
  score: number;
  grade: string;
  size?: number;
};

export function ScoreRing({ score, grade, size = 140 }: Props) {
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = trustGradeColor(grade);

  return (
    <div className="socket-score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Score ${score} out of 100, grade ${grade}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(148, 163, 184, 0.2)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="46%" textAnchor="middle" className="socket-score-ring-value">
          {score}
        </text>
        <text x="50%" y="62%" textAnchor="middle" className="socket-score-ring-label">
          / 100
        </text>
      </svg>
      <span className="socket-score-ring-grade" style={{ background: color }}>
        {grade}
      </span>
    </div>
  );
}
