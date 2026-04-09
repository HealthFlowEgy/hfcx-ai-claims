'use client';

import { useLocale } from 'next-intl';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { cn, toArabicDigits } from '@/lib/utils';

/**
 * Reusable KPI metric card used by every portal dashboard.
 * Supports optional trend direction and a threshold alert state.
 */
export interface KpiCardProps {
  label: string;
  value: string | number;
  trend?: number; // +/- %; 0 or undefined hides the indicator
  threshold?: { warn: number; alert: number; higherIsBad?: boolean };
  className?: string;
  icon?: React.ReactNode;
  sublabel?: string;
}

export function KpiCard({
  label,
  value,
  trend,
  threshold,
  className,
  icon,
  sublabel,
}: KpiCardProps) {
  const locale = useLocale();
  const displayValue =
    typeof value === 'number' && locale === 'ar'
      ? toArabicDigits(value)
      : value;

  let state: 'ok' | 'warn' | 'alert' = 'ok';
  if (threshold && typeof value === 'number') {
    if (threshold.higherIsBad) {
      if (value >= threshold.alert) state = 'alert';
      else if (value >= threshold.warn) state = 'warn';
    } else {
      if (value <= threshold.alert) state = 'alert';
      else if (value <= threshold.warn) state = 'warn';
    }
  }

  const stateBorder =
    state === 'alert'
      ? 'border-hcx-danger/40'
      : state === 'warn'
      ? 'border-hcx-warning/40'
      : 'border-border';

  return (
    <Card className={cn('transition-colors', stateBorder, className)}>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-hcx-text-muted">
            {label}
          </p>
          <p className="text-2xl font-bold tabular-nums text-hcx-text">
            {displayValue}
          </p>
          {sublabel && (
            <p className="text-xs text-hcx-text-muted">{sublabel}</p>
          )}
          {trend != null && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 text-xs font-semibold',
                trend > 0
                  ? 'text-hcx-success'
                  : trend < 0
                  ? 'text-hcx-danger'
                  : 'text-hcx-text-muted',
              )}
            >
              {trend > 0 ? (
                <ArrowUp className="size-3" aria-hidden />
              ) : trend < 0 ? (
                <ArrowDown className="size-3" aria-hidden />
              ) : (
                <Minus className="size-3" aria-hidden />
              )}
              {locale === 'ar'
                ? toArabicDigits(Math.abs(trend).toFixed(1))
                : Math.abs(trend).toFixed(1)}
              %
            </span>
          )}
        </div>
        {icon && (
          <div className="rounded-lg bg-hcx-primary-light/60 p-2 text-hcx-primary">
            {icon}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
