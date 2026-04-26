'use client';

import { useTranslations, useLocale } from 'next-intl';

import { cn, clamp, toArabicDigits } from '@/lib/utils';

/**
 * SRS §DS-AI-001 — AI confidence as a color-coded progress bar.
 */
export interface ConfidenceBarProps {
  confidence: number; // 0..1
  label?: string;
  className?: string;
  showPercentage?: boolean;
}

function bucketColor(confidence: number): { bar: string; text: string } {
  if (confidence >= 0.8) {
    return { bar: 'bg-emerald-500', text: 'text-emerald-600' };
  }
  if (confidence >= 0.5) {
    return { bar: 'bg-amber-500', text: 'text-amber-600' };
  }
  return { bar: 'bg-red-500', text: 'text-red-600' };
}

export function ConfidenceBar({
  confidence,
  label,
  className,
  showPercentage = true,
}: ConfidenceBarProps) {
  const t = useTranslations('ai');
  const locale = useLocale();
  const value = clamp(confidence, 0, 1);
  const pct = Math.round(value * 100);
  const { bar, text } = bucketColor(value);
  const displayPct =
    locale === 'ar' ? toArabicDigits(pct) : String(pct);

  return (
    <div
      className={cn('space-y-1', className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? t('confidence')}
    >
      {(label || showPercentage) && (
        <div className="flex items-center justify-between text-[12px]">
          {label && (
            <span className="text-slate-500">{label}</span>
          )}
          {showPercentage && (
            <span
              className={cn('font-bold tabular-nums', text)}
            >
              {displayPct}%
            </span>
          )}
        </div>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            bar,
          )}
          style={{
            width: `${Math.max(pct, value > 0 ? 2 : 0)}%`,
          }}
        />
      </div>
    </div>
  );
}
