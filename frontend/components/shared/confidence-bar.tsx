'use client';

import { useTranslations, useLocale } from 'next-intl';

import { cn, clamp, toArabicDigits } from '@/lib/utils';

/**
 * SRS §DS-AI-001 — AI confidence as both numeric percentage and a
 * color-coded progress bar: green ≥ 0.80, amber 0.50-0.79, red < 0.50.
 */
export interface ConfidenceBarProps {
  confidence: number;           // 0..1
  label?: string;
  className?: string;
  showPercentage?: boolean;
}

function bucketColor(confidence: number): { bar: string; text: string } {
  if (confidence >= 0.8) {
    return { bar: 'bg-hcx-success', text: 'text-hcx-success' };
  }
  if (confidence >= 0.5) {
    return { bar: 'bg-hcx-warning', text: 'text-hcx-warning' };
  }
  return { bar: 'bg-hcx-danger', text: 'text-hcx-danger' };
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
  const displayPct = locale === 'ar' ? toArabicDigits(pct) : String(pct);

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
        <div className="flex items-center justify-between text-xs">
          {label && <span className="text-hcx-text-muted">{label}</span>}
          {showPercentage && (
            <span className={cn('font-semibold tabular-nums', text)}>
              {displayPct}%
            </span>
          )}
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={cn('h-full transition-all', bar)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
