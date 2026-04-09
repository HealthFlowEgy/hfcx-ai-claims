'use client';

import { useLocale, useTranslations } from 'next-intl';

import { cn, clamp, toArabicDigits } from '@/lib/utils';

/**
 * SRS §DS-AI-004 — fraud risk gauge (0–100) with three colored zones:
 *   Low     0-30   green
 *   Medium  31-60  amber
 *   High    61-100 red
 *
 * Rendered as an inline SVG semi-circle so there are no external chart
 * dependencies on the critical path (Recharts is used for the larger
 * analytics visualizations — a simple gauge stays fast).
 */
export interface FraudGaugeProps {
  score: number; // 0..1
  className?: string;
  size?: number; // px
  showFactors?: boolean;
  factors?: string[];
}

function zoneColor(score: number): string {
  if (score >= 0.6) return 'hsl(var(--hcx-danger))';
  if (score >= 0.3) return 'hsl(var(--hcx-warning))';
  return 'hsl(var(--hcx-success))';
}

export function FraudGauge({
  score,
  className,
  size = 160,
  showFactors = false,
  factors = [],
}: FraudGaugeProps) {
  const t = useTranslations('risk');
  const locale = useLocale();

  const value = clamp(score, 0, 1);
  const pct = Math.round(value * 100);
  const pctText = locale === 'ar' ? toArabicDigits(pct) : String(pct);

  // Semi-circle geometry
  const cx = size / 2;
  const cy = size * 0.55;
  const r = size * 0.42;
  const strokeWidth = size * 0.08;

  // Arc path from (cx - r) to (cx + r) through the top.
  const startX = cx - r;
  const endX = cx + r;
  const arcY = cy - r;

  // End point along the arc for the fill.
  const angle = Math.PI * (1 - value); // 180° → 0°
  const fillEndX = cx + r * Math.cos(angle);
  const fillEndY = cy - r * Math.sin(angle);

  const bg = `M ${startX} ${cy} A ${r} ${r} 0 0 1 ${endX} ${cy}`;
  const fill = `M ${startX} ${cy} A ${r} ${r} 0 0 1 ${fillEndX} ${fillEndY}`;

  const color = zoneColor(value);
  const riskBucket = value >= 0.6 ? 'high' : value >= 0.3 ? 'medium' : 'low';

  return (
    <div
      className={cn('flex flex-col items-center gap-2', className)}
      role="img"
      aria-label={`${t('score')}: ${pct}% (${t(riskBucket)})`}
    >
      <svg width={size} height={size * 0.65} viewBox={`0 0 ${size} ${size * 0.65}`}>
        {/* background arc */}
        <path
          d={bg}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* fill arc */}
        <path
          d={fill}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* numeric center */}
        <text
          x={cx}
          y={cy - size * 0.02}
          textAnchor="middle"
          className="fill-hcx-text font-bold"
          style={{ fontSize: size * 0.22 }}
        >
          {pctText}
        </text>
        <text
          x={cx}
          y={cy + size * 0.12}
          textAnchor="middle"
          className="fill-hcx-text-muted"
          style={{ fontSize: size * 0.1 }}
        >
          {t('score')}
        </text>
        {/* tick labels (start/end) are hidden for compactness but still in aria label */}
        <text
          x={startX}
          y={arcY + r + strokeWidth * 2}
          className="fill-hcx-text-muted"
          style={{ fontSize: size * 0.08 }}
          textAnchor="start"
        >
          {locale === 'ar' ? toArabicDigits(0) : '0'}
        </text>
        <text
          x={endX}
          y={arcY + r + strokeWidth * 2}
          className="fill-hcx-text-muted"
          style={{ fontSize: size * 0.08 }}
          textAnchor="end"
        >
          {locale === 'ar' ? toArabicDigits(100) : '100'}
        </text>
      </svg>
      <span
        className="rounded-full px-2 py-0.5 text-xs font-semibold"
        style={{ backgroundColor: `${color}22`, color }}
      >
        {t(riskBucket)}
      </span>
      {showFactors && factors.length > 0 && (
        <ul className="mt-1 w-full space-y-1 text-xs text-hcx-text-muted">
          {factors.slice(0, 3).map((f, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className="mt-1 inline-block size-1.5 shrink-0 rounded-full bg-hcx-text-muted" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
