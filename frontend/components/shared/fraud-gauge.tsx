'use client';

import { useLocale, useTranslations } from 'next-intl';

import { cn, clamp, toArabicDigits } from '@/lib/utils';

/**
 * SRS §DS-AI-004 — Fraud risk gauge (0–100) with three colored zones.
 * Rendered as an inline SVG semi-circle.
 */
export interface FraudGaugeProps {
  score: number; // 0..1
  className?: string;
  size?: number; // px
  showFactors?: boolean;
  factors?: string[];
}

function zoneColor(score: number): string {
  if (score >= 0.6) return '#E74C3C';
  if (score >= 0.3) return '#F39C12';
  return '#27AE60';
}

function zoneBg(score: number): string {
  if (score >= 0.6) return 'bg-red-50 text-red-700';
  if (score >= 0.3) return 'bg-amber-50 text-amber-700';
  return 'bg-emerald-50 text-emerald-700';
}

export function FraudGauge({
  score,
  className,
  size = 120,
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
  const cy = size * 0.52;
  const r = size * 0.38;
  const strokeWidth = size * 0.07;

  const startX = cx - r;
  const endX = cx + r;

  // End point along the arc for the fill
  const angle = Math.PI * (1 - value);
  const fillEndX = cx + r * Math.cos(angle);
  const fillEndY = cy - r * Math.sin(angle);

  const largeArc = value > 0.5 ? 1 : 0;
  const bg = `M ${startX} ${cy} A ${r} ${r} 0 1 1 ${endX} ${cy}`;
  const fill = `M ${startX} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${fillEndX} ${fillEndY}`;

  const color = zoneColor(value);
  const riskBucket =
    value >= 0.6 ? 'high' : value >= 0.3 ? 'medium' : 'low';

  return (
    <div
      className={cn('flex flex-col items-center', className)}
      role="img"
      aria-label={`${t('score')}: ${pct}% (${t(riskBucket)})`}
    >
      <svg
        width={size}
        height={size * 0.58}
        viewBox={`0 0 ${size} ${size * 0.58}`}
      >
        {/* Background arc */}
        <path
          d={bg}
          fill="none"
          stroke="#E2E8F0"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Colored fill arc */}
        <path
          d={fill}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Score number */}
        <text
          x={cx}
          y={cy - size * 0.04}
          textAnchor="middle"
          fill="#1E293B"
          fontWeight="700"
          style={{ fontSize: size * 0.24 }}
        >
          {pctText}
        </text>
        {/* Label */}
        <text
          x={cx}
          y={cy + size * 0.1}
          textAnchor="middle"
          fill="#94A3B8"
          style={{ fontSize: size * 0.09 }}
        >
          {t('score')}
        </text>
      </svg>

      <span
        className={cn(
          'mt-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
          zoneBg(value),
        )}
      >
        {t(riskBucket)}
      </span>

      {showFactors && factors.length > 0 && (
        <ul className="mt-2 w-full space-y-0.5 text-[11px] text-slate-500">
          {factors.slice(0, 3).map((f, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className="mt-1.5 inline-block size-1 shrink-0 rounded-full bg-slate-400" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
