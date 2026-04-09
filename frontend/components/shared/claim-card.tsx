'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Clock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn, formatEgp, maskNationalId } from '@/lib/utils';
import type { AdjudicationDecision, ClaimSummary } from '@/lib/types';

/**
 * Claim card used in the Payer Kanban board (SRS §5.2.1).
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

function riskBarColor(score: number | null): string {
  if (score == null) return 'bg-muted';
  if (score >= 0.6) return 'bg-hcx-danger';
  if (score >= 0.3) return 'bg-hcx-warning';
  return 'bg-hcx-success';
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

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-start transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        active && 'ring-2 ring-hcx-primary',
      )}
      aria-label={`${claim.claim_id}`}
    >
      <Card className="hover:shadow-md">
        <div className="space-y-2 p-3">
          <div className="flex items-start justify-between gap-2">
            <span className="font-mono text-xs text-hcx-text-muted">
              {claim.claim_id}
            </span>
            <Badge variant={recommendationVariant(claim.ai_recommendation)}>
              {recLabel}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium">{claim.claim_type}</span>
            <span className="font-semibold tabular-nums text-hcx-text">
              {formatEgp(claim.total_amount, locale)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-hcx-text-muted">
            <span className="font-mono">{maskNationalId(claim.patient_nid_masked)}</span>
            <span>•</span>
            <span>{claim.provider_id}</span>
          </div>
          {claim.ai_risk_score != null && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full', riskBarColor(claim.ai_risk_score))}
                style={{ width: `${Math.round(claim.ai_risk_score * 100)}%` }}
              />
            </div>
          )}
          <div className="flex items-center gap-1 text-xs text-hcx-text-muted">
            <Clock className="size-3" aria-hidden />
            {new Date(claim.submitted_at).toLocaleString(
              locale === 'ar' ? 'ar-EG' : 'en-EG',
              { hour: '2-digit', minute: '2-digit' },
            )}
          </div>
        </div>
      </Card>
    </button>
  );
}
