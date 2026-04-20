'use client';

import { useTranslations } from 'next-intl';
import {
  Ban,
  Banknote,
  Brain,
  CheckCircle,
  Clock,
  Search,
  Send,
  SplitSquareHorizontal,
  XCircle,
} from 'lucide-react';

import type { ClaimStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * SRS §2.3 — consistent color-coded status pill across all portals.
 * Every badge includes color + icon + translated label per
 * DS-A11Y-002 (color alone is never the sole indicator).
 */
const STATUS_STYLES: Record<ClaimStatus, { classes: string; Icon: React.ComponentType<{ className?: string }> }> = {
  submitted: { classes: 'badge-submitted', Icon: Send },
  in_review: { classes: 'badge-in-review', Icon: Clock },
  ai_analyzed: { classes: 'badge-ai-analyzed', Icon: Brain },
  approved: { classes: 'badge-approved', Icon: CheckCircle },
  denied: { classes: 'badge-denied', Icon: XCircle },
  investigating: { classes: 'badge-investigating', Icon: Search },
  settled: { classes: 'badge-settled', Icon: Banknote },
  voided: { classes: 'badge-voided', Icon: Ban },
  // ISSUE-007: Add partial status
  partial: { classes: 'badge-in-review', Icon: SplitSquareHorizontal },
};

export interface ClaimStatusBadgeProps {
  status: ClaimStatus;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function ClaimStatusBadge({
  status,
  className,
  size = 'md',
}: ClaimStatusBadgeProps) {
  const t = useTranslations('status');
  const { classes, Icon } = STATUS_STYLES[status];
  const sizeClass =
    size === 'sm'
      ? 'text-xs px-2 py-0.5'
      : size === 'lg'
      ? 'text-sm px-3 py-1'
      : 'text-xs px-2.5 py-1';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        classes,
        sizeClass,
        className,
      )}
      aria-label={t(status)}
      data-status={status}
    >
      <Icon className="size-3.5" aria-hidden />
      <span>{t(status)}</span>
    </span>
  );
}
