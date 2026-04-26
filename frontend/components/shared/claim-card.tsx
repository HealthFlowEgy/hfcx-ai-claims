'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Clock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn, formatEgp, maskNationalId } from '@/lib/utils';
import type { AdjudicationDecision, ClaimSummary } from '@/lib/types';

/**
 * Claim card used in the Payer Kanban board (SRS §5.2.1).
 * Redesigned for better visual hierarchy and information density.
 */
export interface ClaimCardProps {
  claim: ClaimSummary;
  onClick?: () => void;
  active?: boolean;
}

function recommendationVariant(
  rec: AdjudicationDecision | null,
): 'success' | 'destructive' | 'investigate' | 'muted' {
  if (rec === 'approved') return 'success';
  if (rec === 'denied') return 'destructive';
  if (rec === 'pended' || rec === 'partial') return 'investigate';
  return 'muted';
}

function riskInfo(score: number | null): {
  color: string;
  bg: string;
  label: string;
} {
  if (score == null)
    return { color: 'bg-slate-300', bg: 'bg-slate-100', label: '—' };
  if (score >= 0.6)
    return {
      color: 'bg-red-500',
      bg: 'bg-red-50',
      label: `${Math.round(score * 100)}%`,
    };
  if (score >= 0.3)
    return {
      color: 'bg-amber-500',
      bg: 'bg-amber-50',
      label: `${Math.round(score * 100)}%`,
    };
  return {
    color: 'bg-emerald-500',
    bg: 'bg-emerald-50',
    label: `${Math.round(score * 100)}%`,
  };
}

export function ClaimCard({ claim, onClick, active }: ClaimCardProps) {
  const t = useTranslations('recommendation');
  const locale = useLocale() as 'ar' | 'en';
  const recLabel = claim.ai_recommendation
    ? t(
        claim.ai_recommendation === 'approved'
          ? 'approve'
          : claim.ai_recommendation === 'denied'
            ? 'deny'
            : 'investigate',
      )
    : t('none');

  const risk = riskInfo(claim.ai_risk_score);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-start transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        active && 'ring-2 ring-hcx-primary',
      )}
      aria-label={claim.claim_id}
    >
      <Card
        className={cn(
          'overflow-hidden border-slate-200 transition-shadow hover:shadow-md',
          active && 'border-hcx-primary/50 bg-hcx-primary-light/20',
        )}
      >
        <div className="p-2.5">
          {/* Row 1: Claim ID + Badge */}
          <div className="flex items-center justify-between gap-1.5 mb-1.5">
            <span className="truncate font-mono text-[11px] text-slate-500">
              {claim.claim_id}
            </span>
            <Badge
              variant={recommendationVariant(claim.ai_recommendation)}
              className="shrink-0 text-[10px] px-1.5 py-0"
            >
              {recLabel}
            </Badge>
          </div>

          {/* Row 2: Amount + Type */}
          <div className="flex items-baseline justify-between gap-2 mb-1.5">
            <span className="text-sm font-bold tabular-nums text-slate-800">
              {formatEgp(claim.total_amount, locale)}
            </span>
            <span className="text-[11px] text-slate-500">
              {claim.claim_type}
            </span>
          </div>

          {/* Row 3: Provider + Patient */}
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-2">
            <span className="truncate">{claim.provider_id}</span>
            <span className="text-slate-300">&middot;</span>
            <span className="font-mono truncate">
              {maskNationalId(claim.patient_nid_masked)}
            </span>
          </div>

          {/* Row 4: Risk bar (labeled) */}
          {claim.ai_risk_score != null && (
            <div className="mb-1.5">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] text-slate-400">
                  Risk
                </span>
                <span
                  className={cn(
                    'text-[10px] font-semibold tabular-nums',
                    claim.ai_risk_score >= 0.6
                      ? 'text-red-600'
                      : claim.ai_risk_score >= 0.3
                        ? 'text-amber-600'
                        : 'text-emerald-600',
                  )}
                >
                  {risk.label}
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    risk.color,
                  )}
                  style={{
                    width: `${Math.round(claim.ai_risk_score * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Row 5: Timestamp */}
          <div className="flex items-center gap-1 text-[10px] text-slate-400">
            <Clock className="size-2.5" aria-hidden />
            <span className="tabular-nums">
              {new Date(claim.submitted_at).toLocaleString(
                locale === 'ar' ? 'ar-EG' : 'en-EG',
                { hour: '2-digit', minute: '2-digit' },
              )}
            </span>
          </div>
        </div>
      </Card>
    </button>
  );
}
