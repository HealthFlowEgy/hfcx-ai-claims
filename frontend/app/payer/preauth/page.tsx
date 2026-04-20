'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Stethoscope, XCircle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { cn, formatDate, formatEgp } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

type PreAuthReview = {
  request_id: string;
  patient_nid_masked: string;
  icd10: string;
  procedure: string;
  amount: number;
  requested_at: string;
  verdict: 'necessary' | 'needs_review' | 'not_justified';
  guidelines: string[];
  confidence: number;
};

const SEED_REVIEWS: PreAuthReview[] = [
  {
    request_id: 'PA-2026-201',
    patient_nid_masked: '**********4567',
    icd10: 'M54.5',
    procedure: 'MRI Lumbar',
    amount: 4200,
    requested_at: new Date(Date.now() - 86400000).toISOString(),
    verdict: 'needs_review',
    guidelines: [
      'NHIA MSK Imaging Policy 2024 §3.2',
      'MOH Clinical Practice Guideline — Lower Back Pain v1.3',
    ],
    confidence: 0.62,
  },
  {
    request_id: 'PA-2026-200',
    patient_nid_masked: '**********8910',
    icd10: 'E11.9',
    procedure: 'Continuous glucose monitor',
    amount: 1800,
    requested_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    verdict: 'necessary',
    guidelines: ['EDA Diabetes Standards of Care 2023 §8.1'],
    confidence: 0.91,
  },
  {
    request_id: 'PA-2026-199',
    patient_nid_masked: '**********1122',
    icd10: 'Z00.00',
    procedure: 'Full-body CT screen',
    amount: 9800,
    requested_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    verdict: 'not_justified',
    guidelines: ['NHIA Preventive Imaging Policy — not covered'],
    confidence: 0.88,
  },
];

// ISSUE-022: Decision type for preauth
type DecisionType = 'approved' | 'partial' | 'more_info' | 'denied';

export default function PayerPreAuthPage() {
  const t = useTranslations('payer.preauth');
  const tq = useTranslations('payer.queue');
  const locale = useLocale() as 'ar' | 'en';
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(
    SEED_REVIEWS[0]?.request_id ?? null,
  );
  const selected = SEED_REVIEWS.find((r) => r.request_id === selectedId);

  // ISSUE-022: Decision mutation
  const decisionMutation = useMutation({
    mutationFn: async ({
      requestId,
      decision,
    }: {
      requestId: string;
      decision: DecisionType;
    }) => {
      const resp = await fetch(
        `/api/proxy/internal/ai/bff/payer/preauth/${requestId}/decision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision }),
        },
      );
      if (!resp.ok) throw new Error('Decision submission failed');
      return resp.json();
    },
    onSuccess: (_data, variables) => {
      toast({
        variant: 'success',
        title: 'Decision submitted',
        description: `Pre-auth ${variables.requestId} marked as ${variables.decision}`,
      });
      queryClient.invalidateQueries({ queryKey: ['payer', 'preauth'] });
    },
    onError: () => {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to submit decision. Please try again.',
      });
    },
  });

  const handleDecision = (decision: DecisionType) => {
    if (!selectedId) return;
    decisionMutation.mutate({ requestId: selectedId, decision });
  };

  const isPending = decisionMutation.isPending;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        <p className="text-sm text-hcx-text-muted">{t('intro')}</p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-2">
            {SEED_REVIEWS.map((r) => (
              <button
                key={r.request_id}
                type="button"
                onClick={() => setSelectedId(r.request_id)}
                className={cn(
                  'w-full rounded-md border p-3 text-start transition-colors',
                  selectedId === r.request_id
                    ? 'border-hcx-primary bg-hcx-primary-light/60'
                    : 'border-border hover:bg-accent',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{r.request_id}</span>
                  <VerdictBadge verdict={r.verdict} />
                </div>
                <div className="mt-1 text-sm">
                  {r.icd10} · {r.procedure}
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-hcx-text-muted">
                  <span>{formatEgp(r.amount, locale)}</span>
                  <span>{formatDate(r.requested_at, locale)}</span>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        {selected && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Stethoscope
                  className="size-5 text-hcx-primary"
                  aria-hidden
                />
                {selected.request_id}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert
                variant={
                  selected.verdict === 'necessary'
                    ? 'success'
                    : selected.verdict === 'needs_review'
                    ? 'warning'
                    : 'destructive'
                }
              >
                <AlertTitle>
                  {t('necessityVerdict')}:{' '}
                  {selected.verdict === 'necessary'
                    ? t('necessary')
                    : selected.verdict === 'needs_review'
                    ? t('needsReview')
                    : t('notJustified')}
                </AlertTitle>
                <AlertDescription>
                  AI confidence: {Math.round(selected.confidence * 100)}%
                </AlertDescription>
              </Alert>

              <div>
                <h3 className="mb-2 text-sm font-semibold">
                  {t('guidelines')}
                </h3>
                <ul className="list-disc space-y-1 ps-5 text-sm text-hcx-text-muted">
                  {selected.guidelines.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </div>

              {/* ISSUE-022: Decision buttons with onClick handlers */}
              <div className="grid grid-cols-2 gap-2 pt-2 md:grid-cols-4">
                <Button
                  variant="success"
                  onClick={() => handleDecision('approved')}
                  disabled={isPending}
                >
                  {isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-4" aria-hidden />
                  )}
                  {tq('approve')}
                </Button>
                <Button
                  variant="default"
                  onClick={() => handleDecision('partial')}
                  disabled={isPending}
                >
                  {t('partialApprove')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleDecision('more_info')}
                  disabled={isPending}
                >
                  {t('requestMoreInfo')}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => handleDecision('denied')}
                  disabled={isPending}
                >
                  {isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <XCircle className="size-4" aria-hidden />
                  )}
                  {tq('deny')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function VerdictBadge({
  verdict,
}: {
  verdict: 'necessary' | 'needs_review' | 'not_justified';
}) {
  const t = useTranslations('payer.preauth');
  if (verdict === 'necessary')
    return <Badge variant="success">{t('necessary')}</Badge>;
  if (verdict === 'needs_review')
    return <Badge variant="warning">{t('needsReview')}</Badge>;
  return <Badge variant="destructive">{t('notJustified')}</Badge>;
}
